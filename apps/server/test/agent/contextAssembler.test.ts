import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createFileToolRegistry } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { immediateTransaction } from "../../src/db/transaction.js";
import { assembleContext } from "../../src/modules/agent/contextAssembler.js";
import { appendAgentEvent } from "../../src/modules/agent/events.js";
import { createProject, updateProject } from "../../src/modules/projects/service.js";
import { getSessionById, getTurnById } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

describe("context assembler", () => {
  it("orders safety, project instructions, history and the current request", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const project = await createProject(
          { db: opened.db, detectGit: async () => false, now: () => 1 },
          { rootPath: root },
        );
        updateProject(
          { db: opened.db, now: () => 2 },
          { id: project.id, settings: { instructions: "Always use tabs." } },
        );
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, { projectId: project.id });
        const first = createTurn(sessionOptions, { sessionId: session.id, text: "first task" });
        immediateTransaction(opened.db, (tx) => {
          appendAgentEvent(tx, {
            sessionId: session.id,
            turnId: first.turnId,
            type: "assistant.message",
            payload: {
              turnId: first.turnId,
              messageId: "msg_1",
              text: `first answer ${"x".repeat(8_000)}`,
            },
            now: 11,
          });
        });
        opened.sqlite
          .prepare("UPDATE turns SET status = 'COMPLETED' WHERE id = ?")
          .run(first.turnId);
        const second = createTurn(sessionOptions, { sessionId: session.id, text: "second task" });
        const sessionRow = getSessionById(opened.db, session.id);
        const turnRow = getTurnById(opened.db, second.turnId);

        if (sessionRow === null || turnRow === null) {
          throw new Error("fixture missing");
        }

        const context = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 128_000,
          },
          sessionRow,
          turnRow,
        );

        expect(context.messages[0]).toMatchObject({ role: "system" });
        expect(String(context.messages[0]?.content)).toContain("Always use tabs.");
        expect(context.messages.map((message) => message.role)).toEqual([
          "system",
          "user",
          "assistant",
          "user",
        ]);
        expect(context.tools.map((tool) => tool.name)).toContain("apply_patch");
        expect(context.truncatedHistory).toBe(false);

        const narrow = assembleContext(
          {
            db: opened.db,
            registry: createFileToolRegistry(),
            maxContextTokens: 100,
          },
          sessionRow,
          turnRow,
        );
        expect(narrow.truncatedHistory).toBe(true);
      } finally {
        opened.close();
      }
    });
  });
});
