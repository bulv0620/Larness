import type { EncryptedSecretRef } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { appendAgentEvent } from "../../src/modules/agent/events.js";
import {
  buildToolOperation,
  operationLog,
  parseToolOperation,
  redactOperationText,
} from "../../src/modules/agent/turn/operationLog.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import type { SecretStore } from "../../src/security/secretStore.js";
import { withTempDir } from "../helpers.js";

const VERSION = "a".repeat(64);

function commandOperation() {
  return buildToolOperation({
    toolCallId: "call_cmd",
    toolName: "run_command",
    ok: false,
    summary: "Command FAILED; exit code 1",
    argsSummary: "pnpm check",
    errorCode: "NONZERO_EXIT",
    command: {
      display: "pnpm check",
      exitCode: 1,
      outputTail: "FAIL src/a.test.ts\nTests 1 failed",
      truncated: true,
    },
  });
}

function fileOperation() {
  return buildToolOperation({
    toolCallId: "call_edit",
    toolName: "edit",
    ok: true,
    summary: "edited src/a.ts",
    argsSummary: "src/a.ts",
    file: {
      path: "src/a.ts",
      version: VERSION,
      changeType: "modified",
      additions: 2,
      deletions: 1,
      replacements: 1,
    },
  });
}

describe("tool operation records", () => {
  it("round-trips a bounded command operation", () => {
    const operation = commandOperation();

    expect(operation.command).toMatchObject({ exitCode: 1, truncated: true });
    expect(parseToolOperation(JSON.stringify(operation))).toEqual(operation);
    expect(parseToolOperation("{not-json")).toBeNull();
    expect(parseToolOperation(JSON.stringify({ toolName: "edit" }))).toBeNull();
  });

  it("clips arguments and keeps the command tail", () => {
    const operation = buildToolOperation({
      toolCallId: "call",
      toolName: "run_command",
      ok: true,
      summary: "ok",
      argsSummary: "x".repeat(900),
      command: {
        display: "y".repeat(900),
        exitCode: 0,
        outputTail: `${"head\n".repeat(500)}LAST LINE`,
      },
    });

    expect(operation.argsSummary?.length).toBeLessThanOrEqual(401);
    expect(operation.command?.display.length).toBeLessThanOrEqual(401);
    expect(operation.command?.outputTail).toContain("LAST LINE");
    expect(operation.command?.outputTail?.length).toBeLessThanOrEqual(801);
  });

  it("drops text containing a known secret", () => {
    const secrets: EncryptedSecretRef[] = [{ ciphertext: "c", nonce: "n", tag: "t" }];
    const store = { decrypt: () => "top-secret-value" } as unknown as SecretStore;

    expect(redactOperationText("token=top-secret-value", secrets, store)).toBeNull();
    expect(redactOperationText("plain output", [], undefined)).toBe("plain output");
  });
});

describe("operation log assembly", () => {
  it("renders previous operations, excludes the current turn and honors coverage", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(`${dir}/test.db`);
      runMigrations(opened.db);
      const options = { db: opened.db, dataDir: dir };
      const session = await createSession(options, {});
      const previous = createTurn(options, { sessionId: session.id, text: "first" });
      const first = appendAgentEvent(opened.db, {
        sessionId: session.id,
        turnId: previous.turnId,
        type: "tool.operation",
        payload: commandOperation(),
        now: 1,
      });
      appendAgentEvent(opened.db, {
        sessionId: session.id,
        turnId: previous.turnId,
        type: "tool.operation",
        payload: fileOperation(),
        now: 2,
      });
      opened.sqlite
        .prepare("UPDATE turns SET status = 'COMPLETED' WHERE id = ?")
        .run(previous.turnId);
      const current = createTurn(options, { sessionId: session.id, text: "second" });
      appendAgentEvent(opened.db, {
        sessionId: session.id,
        turnId: current.turnId,
        type: "tool.operation",
        payload: buildToolOperation({
          toolCallId: "call_current",
          toolName: "run_command",
          ok: true,
          summary: "current",
          argsSummary: "current-only",
        }),
        now: 3,
      });

      try {
        const log = operationLog(opened.db, session.id, current.turnId, 0);
        expect(log.count).toBe(2);
        expect(log.omitted).toBe(0);
        expect(log.text).toContain("run_command: pnpm check");
        expect(log.text).toContain("exit 1");
        expect(log.text).toContain("Tests 1 failed");
        expect(log.text).toContain("edit: src/a.ts");
        expect(log.text).toContain("version aaaaaaaaaaaa");
        expect(log.text).toContain("+2 -1");
        expect(log.text).toContain("1 replacement(s)");
        expect(log.text).not.toContain("current-only");

        const covered = operationLog(opened.db, session.id, current.turnId, first.seq);
        expect(covered.count).toBe(1);
        expect(covered.text).toContain("edit: src/a.ts");
        expect(covered.text).not.toContain("pnpm check");
      } finally {
        opened.close();
      }
    });
  });

  it("keeps the newest operations and reports older omissions under a tight budget", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(`${dir}/test.db`);
      runMigrations(opened.db);
      const options = { db: opened.db, dataDir: dir };
      const session = await createSession(options, {});
      const turn = createTurn(options, { sessionId: session.id, text: "tight" });

      for (let index = 0; index < 4; index += 1) {
        appendAgentEvent(opened.db, {
          sessionId: session.id,
          turnId: turn.turnId,
          type: "tool.operation",
          payload: buildToolOperation({
            toolCallId: `call_${index}`,
            toolName: "run_command",
            ok: true,
            summary: `command ${index}`,
            argsSummary: `command-${index} ${"x".repeat(200)}`,
            command: { display: `command-${index}`, exitCode: 0 },
          }),
          now: index + 1,
        });
      }

      try {
        const tight = operationLog(opened.db, session.id, "turn_other", 0, 5);
        expect(tight.count).toBe(1);
        expect(tight.omitted).toBe(3);
        expect(tight.text).toContain("command-3");
        expect(tight.text).toContain("3 older operation(s) omitted");
        expect(tight.text).not.toContain("command-0");
      } finally {
        opened.close();
      }
    });
  });
});
