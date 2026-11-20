import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFileToolRegistry, type ToolRegistry } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createCommandTool, createShellTool } from "../../src/modules/agent/commandTool.js";
import { createMemoryTools } from "../../src/modules/agent/memoryTool.js";
import { createObservationTool } from "../../src/modules/agent/observationTool.js";
import { createPlanTool } from "../../src/modules/agent/planTool.js";
import { createProcessTools } from "../../src/modules/agent/processTool.js";
import { createServiceOpsTools } from "../../src/modules/agent/serviceOpsTool.js";
import { type ExecuteToolInput, executeTool } from "../../src/modules/agent/toolExecutor.js";
import { createWebTools } from "../../src/modules/agent/webTool.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

function buildRegistry(opened: OpenedDatabase): ToolRegistry {
  const registry = createFileToolRegistry();
  registry.register(createPlanTool({ db: opened.db }));
  registry.register(createCommandTool({}));
  registry.register(createShellTool({}));
  for (const tool of createProcessTools({})) registry.register(tool);
  for (const tool of createServiceOpsTools()) registry.register(tool);
  for (const tool of createMemoryTools()) registry.register(tool);
  for (const tool of createWebTools()) registry.register(tool);
  registry.register(createObservationTool());
  return registry;
}

type HandlerKey = keyof Pick<
  ExecuteToolInput,
  | "updatePlan"
  | "runCommand"
  | "startProcess"
  | "listProcesses"
  | "readProcessOutput"
  | "stopProcess"
  | "listServiceOps"
  | "readServiceOpsLogs"
  | "controlServiceOps"
  | "refreshObservations"
  | "rememberMemory"
  | "readMemory"
  | "webSearch"
  | "fetchUrl"
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
    name: "run_shell",
    handler: "runCommand",
    args: { command: "echo ok" },
    invalid: { cwd: "." },
  },
  {
    name: "start_process",
    handler: "startProcess",
    args: { executable: "node", args: ["-e", "0"], name: "fixture" },
    invalid: { args: ["-e", "0"] },
  },
  {
    name: "read_process_output",
    handler: "readProcessOutput",
    args: { processId: "prc_00000000-0000-4000-8000-000000000000" },
    invalid: { processId: "nope" },
  },
  {
    name: "stop_process",
    handler: "stopProcess",
    args: { processId: "prc_00000000-0000-4000-8000-000000000000" },
    invalid: { processId: "nope" },
  },
  {
    name: "list_processes",
    handler: "listProcesses",
    args: {},
    invalid: { limit: 0 },
  },
  {
    name: "list_service_ops",
    handler: "listServiceOps",
    args: {},
    invalid: { targetId: "x" },
  },
  {
    name: "read_service_ops_logs",
    handler: "readServiceOpsLogs",
    args: { targetId: "tgt_00000000-0000-4000-8000-000000000000" },
    invalid: { targetId: "nope" },
  },
  {
    name: "control_service_ops",
    handler: "controlServiceOps",
    args: { targetId: "tgt_00000000-0000-4000-8000-000000000000", action: "restart" },
    invalid: { targetId: "tgt_00000000-0000-4000-8000-000000000000", action: "deploy" },
  },
  {
    name: "refresh_observations",
    handler: "refreshObservations",
    args: {},
    invalid: { stale: true },
  },
  {
    name: "remember",
    handler: "rememberMemory",
    args: {
      scope: "project",
      kind: "fact",
      key: "build.test.command",
      title: "Test command",
      body: "pnpm test",
      evidence: { kind: "user_statement", quote: "pnpm test" },
    },
    invalid: { scope: "project", kind: "fact", key: "x" },
  },
  {
    name: "read_memory",
    handler: "readMemory",
    args: { query: "test" },
    invalid: { limit: 0 },
  },
  {
    name: "web_search",
    handler: "webSearch",
    args: { query: "latest release", count: 3 },
    invalid: { query: "" },
  },
  {
    name: "fetch_url",
    handler: "fetchUrl",
    args: { url: "https://example.com/article" },
    invalid: { url: "" },
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
            startProcess: handlerStub("startProcess"),
            listProcesses: handlerStub("listProcesses"),
            readProcessOutput: handlerStub("readProcessOutput"),
            stopProcess: handlerStub("stopProcess"),
            listServiceOps: handlerStub("listServiceOps"),
            readServiceOpsLogs: handlerStub("readServiceOpsLogs"),
            controlServiceOps: handlerStub("controlServiceOps"),
            refreshObservations: handlerStub("refreshObservations"),
            rememberMemory: handlerStub("rememberMemory"),
            readMemory: handlerStub("readMemory"),
            webSearch: handlerStub("webSearch"),
            fetchUrl: handlerStub("fetchUrl"),
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
