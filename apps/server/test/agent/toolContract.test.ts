import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFileToolRegistry, type ToolRegistry } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createCommandTool } from "../../src/modules/agent/commandTool.js";
import { createGitTools } from "../../src/modules/agent/gitTool.js";
import { createObservationTool } from "../../src/modules/agent/observationTool.js";
import { createPlanTool } from "../../src/modules/agent/planTool.js";
import { createServiceTools } from "../../src/modules/agent/serviceTool.js";
import { createTerminalControlTools } from "../../src/modules/agent/terminalControlTool.js";
import { createTerminalTools } from "../../src/modules/agent/terminalTool.js";
import { type ExecuteToolInput, executeTool } from "../../src/modules/agent/toolExecutor.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

const TERMINAL = "term_00000000-0000-4000-8000-000000000000";
const SERVICE = "svc_00000000-0000-4000-8000-000000000000";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

function buildRegistry(opened: OpenedDatabase): ToolRegistry {
  const registry = createFileToolRegistry();
  registry.register(createPlanTool({ db: opened.db }));
  registry.register(createCommandTool({}));
  for (const tool of createTerminalTools({ db: opened.db })) registry.register(tool);
  for (const tool of createTerminalControlTools({ db: opened.db })) registry.register(tool);
  for (const tool of createGitTools()) registry.register(tool);
  for (const tool of createServiceTools()) registry.register(tool);
  registry.register(createObservationTool());
  return registry;
}

type HandlerKey = keyof Pick<
  ExecuteToolInput,
  | "updatePlan"
  | "runCommand"
  | "startTerminal"
  | "readTerminalOutput"
  | "stopTerminal"
  | "acquireTerminalControl"
  | "sendTerminalInput"
  | "interruptTerminal"
  | "releaseTerminalControl"
  | "gitRead"
  | "gitAction"
  | "registerService"
  | "listServices"
  | "resolveServicePreview"
  | "refreshObservations"
>;

interface BoundToolCase {
  name: string;
  handler: HandlerKey;
  args: unknown;
  invalid: unknown;
}

/**
 * Every tool that needs a Turn-scoped handler must reach it. A missing binding
 * in `ToolContext` is invisible otherwise: the tool just answers FORBIDDEN.
 */
const BOUND_TOOLS: BoundToolCase[] = [
  {
    name: "update_plan",
    handler: "updatePlan",
    args: { title: "t", steps: [{ id: "a", title: "x", status: "pending" }] },
    invalid: { title: "", steps: [] },
  },
  {
    name: "run_command",
    handler: "runCommand",
    args: { executable: "node", args: ["-e", "0"] },
    invalid: { args: ["-e", "0"] },
  },
  {
    name: "start_project_terminal",
    handler: "startTerminal",
    args: { role: "dev", executable: "node", args: ["server.js"] },
    invalid: { role: "dev", args: ["server.js"] },
  },
  {
    name: "read_terminal_output",
    handler: "readTerminalOutput",
    args: { terminalId: TERMINAL },
    invalid: { terminalId: "nope" },
  },
  {
    name: "stop_project_terminal",
    handler: "stopTerminal",
    args: { terminalId: TERMINAL },
    invalid: { terminalId: "nope" },
  },
  {
    name: "acquire_terminal_control",
    handler: "acquireTerminalControl",
    args: { terminalId: TERMINAL },
    invalid: { terminalId: "nope" },
  },
  {
    name: "send_terminal_input",
    handler: "sendTerminalInput",
    args: { terminalId: TERMINAL, leaseGeneration: 1, inputSequence: 1, data: "ls\n" },
    invalid: { terminalId: TERMINAL },
  },
  {
    name: "interrupt_terminal",
    handler: "interruptTerminal",
    args: { terminalId: TERMINAL, leaseGeneration: 1 },
    invalid: { terminalId: TERMINAL },
  },
  {
    name: "release_terminal_control",
    handler: "releaseTerminalControl",
    args: { terminalId: TERMINAL, leaseGeneration: 1 },
    invalid: { terminalId: TERMINAL },
  },
  { name: "git_status", handler: "gitRead", args: {}, invalid: { bogus: true } },
  { name: "git_diff", handler: "gitRead", args: { path: "a.txt" }, invalid: {} },
  { name: "git_log", handler: "gitRead", args: {}, invalid: { limit: 0 } },
  { name: "git_branches", handler: "gitRead", args: {}, invalid: { limit: 0 } },
  { name: "git_add", handler: "gitAction", args: { paths: ["a.txt"] }, invalid: { paths: [] } },
  { name: "git_commit", handler: "gitAction", args: { message: "m" }, invalid: { message: "" } },
  {
    name: "git_create_branch",
    handler: "gitAction",
    args: { name: "feature" },
    invalid: {},
  },
  {
    name: "git_switch_branch",
    handler: "gitAction",
    args: { name: "feature" },
    invalid: { name: "" },
  },
  { name: "git_pull", handler: "gitAction", args: {}, invalid: { force: true } },
  { name: "git_push", handler: "gitAction", args: {}, invalid: { force: true } },
  {
    name: "register_temporary_service",
    handler: "registerService",
    args: {
      kind: "temporary",
      terminalId: TERMINAL,
      name: "dev",
      endpoint: { host: "127.0.0.1", port: 3000, protocol: "http" },
    },
    invalid: { name: "dev" },
  },
  {
    name: "resolve_service_preview",
    handler: "resolveServicePreview",
    args: { serviceId: SERVICE, path: "/" },
    invalid: { serviceId: "nope" },
  },
  { name: "list_services", handler: "listServices", args: {}, invalid: { limit: 0 } },
  {
    name: "refresh_observations",
    handler: "refreshObservations",
    args: {},
    invalid: { stale: true },
  },
];

const FILE_TOOLS: Array<{ name: string; args: unknown; invalid: unknown }> = [
  { name: "list_files", args: { path: "." }, invalid: { depth: 0 } },
  { name: "read_file", args: { path: "a.txt" }, invalid: {} },
  { name: "search_code", args: { query: "needle" }, invalid: { query: "" } },
  {
    name: "write_file",
    args: { path: "created/new.txt", content: "hi\n" },
    invalid: { content: "x" },
  },
];

describe("tool contract matrix", () => {
  it("registers exactly the documented tool set", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const registry = buildRegistry(opened);
        const names = registry
          .list()
          .map((tool) => tool.name)
          .sort();

        expect(names).toEqual(
          [
            ...BOUND_TOOLS.map((tool) => tool.name),
            ...FILE_TOOLS.map((tool) => tool.name),
            "apply_patch",
          ].sort(),
        );
      } finally {
        opened.close();
      }
    });
  });

  it("reaches the Turn handler for every bound tool and rejects bad arguments", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);
      const projectRoot = path.join(dir, "project");
      await mkdir(projectRoot);
      const realRoot = await realpath(projectRoot);
      const options = { db: opened.db, dataDir: dir, now: () => 1_000 };

      try {
        const session = await createSession(options, {});
        const turn = createTurn(options, { sessionId: session.id, text: "contract" });
        const registry = buildRegistry(opened);
        const executor = { db: opened.db, registry, now: () => 1_000 };
        const invoked: string[] = [];

        const handlerStub = (name: string) => async () => {
          invoked.push(name);
          return { ok: true as const, summary: `handler:${name}` };
        };

        for (const tool of BOUND_TOOLS) {
          const ok = await executeTool(executor, {
            sessionId: session.id,
            turnId: turn.turnId,
            toolCallId: `call_${tool.name}`,
            toolName: tool.name,
            args: tool.args,
            policy: "autonomous",
            projectRoot: realRoot,
            // Every tool gets every handler; the one it needs must be bound.
            updatePlan: handlerStub("updatePlan"),
            runCommand: handlerStub("runCommand"),
            startTerminal: handlerStub("startTerminal"),
            readTerminalOutput: handlerStub("readTerminalOutput"),
            stopTerminal: handlerStub("stopTerminal"),
            acquireTerminalControl: handlerStub("acquireTerminalControl"),
            sendTerminalInput: handlerStub("sendTerminalInput"),
            interruptTerminal: handlerStub("interruptTerminal"),
            releaseTerminalControl: handlerStub("releaseTerminalControl"),
            gitRead: handlerStub("gitRead"),
            gitAction: handlerStub("gitAction"),
            registerService: handlerStub("registerService"),
            listServices: handlerStub("listServices"),
            resolveServicePreview: handlerStub("resolveServicePreview"),
            refreshObservations: handlerStub("refreshObservations"),
          });

          expect(ok.status, tool.name).toBe("completed");
          if (ok.status !== "completed") continue;
          expect(ok.result, `${tool.name} must reach ${tool.handler}`).toMatchObject({
            ok: true,
            summary: expect.stringMatching(/^handler:/),
          });

          const bad = await executeTool(executor, {
            sessionId: session.id,
            turnId: turn.turnId,
            toolCallId: `call_bad_${tool.name}`,
            toolName: tool.name,
            args: tool.invalid,
            policy: "autonomous",
            projectRoot: realRoot,
          });
          expect(bad.status, tool.name).toBe("completed");
          if (bad.status !== "completed") continue;
          expect(bad.result, tool.name).toMatchObject({
            ok: false,
            errorCode: "VALIDATION_ERROR",
          });
          expect(bad.result.summary).toContain("invalid tool arguments:");
        }

        expect(new Set(invoked)).toEqual(
          new Set(BOUND_TOOLS.map((tool) => tool.handler)) as Set<string>,
        );
      } finally {
        opened.close();
      }
    });
  });

  it("runs the file tools against a real project root", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);
      const projectRoot = path.join(dir, "project");
      await mkdir(projectRoot);
      await writeFile(path.join(projectRoot, "a.txt"), "one\nneedle\n");
      const realRoot = await realpath(projectRoot);
      const options = { db: opened.db, dataDir: dir, now: () => 1_000 };

      try {
        const session = await createSession(options, {});
        const turn = createTurn(options, { sessionId: session.id, text: "files" });
        const registry = buildRegistry(opened);
        const executor = { db: opened.db, registry, now: () => 1_000 };
        const call = (name: string, args: unknown, id: string) =>
          executeTool(executor, {
            sessionId: session.id,
            turnId: turn.turnId,
            toolCallId: id,
            toolName: name,
            args,
            policy: "autonomous",
            projectRoot: realRoot,
          });

        for (const tool of FILE_TOOLS) {
          const ok = await call(tool.name, tool.args, `call_${tool.name}`);
          expect(ok.status).toBe("completed");
          if (ok.status === "completed") {
            expect(ok.result, tool.name).toMatchObject({ ok: true });
          }

          const bad = await call(tool.name, tool.invalid, `call_bad_${tool.name}`);
          expect(bad.status).toBe("completed");
          if (bad.status === "completed") {
            expect(bad.result, tool.name).toMatchObject({
              ok: false,
              errorCode: "VALIDATION_ERROR",
            });
          }
        }

        const read = await call("read_file", { path: "a.txt" }, "call_read");
        const version =
          read.status === "completed" ? (read.result.data as { version: string }).version : "";

        const patched = await call(
          "apply_patch",
          {
            path: "a.txt",
            expectedVersion: version,
            patch: "--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n one\n-needle\n+pin\n",
          },
          "call_patch",
        );
        expect(patched.status).toBe("completed");
        if (patched.status === "completed") expect(patched.result).toMatchObject({ ok: true });

        const reread = await call("read_file", { path: "a.txt" }, "call_reread");
        const currentVersion =
          reread.status === "completed" ? (reread.result.data as { version: string }).version : "";

        const badPatch = await call(
          "apply_patch",
          { path: "a.txt", expectedVersion: currentVersion, patch: "not a patch" },
          "call_bad_patch",
        );
        expect(badPatch.status).toBe("completed");
        if (badPatch.status === "completed") {
          expect(badPatch.result).toMatchObject({ ok: false, errorCode: "INVALID_PATCH" });
          expect(badPatch.result.summary).toContain("missing @@ hunk header");
        }
      } finally {
        opened.close();
      }
    });
  });
});
