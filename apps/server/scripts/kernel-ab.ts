/**
 * Deterministic A/B for the 082 coding vs workspace profiles.
 *
 * This script does not call a real model: it replays the same scripted tool
 * trace through TurnRunner for both profiles and measures fixed context cost,
 * steps, tool calls and success. Real-provider success rate needs a separately
 * authorized Key/budget run (see ab.md).
 */
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createFakeProvider,
  createFileToolRegistry,
  type ProviderChunk,
  type ToolRegistry,
} from "@larness/agent";
import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { createBrowserSession } from "../src/db/repositories/browser-sessions.js";
import { createCommandTool, createShellTool } from "../src/modules/agent/commandTool.js";
import { createObservationTool } from "../src/modules/agent/observationTool.js";
import { createPlanTool } from "../src/modules/agent/planTool.js";
import { createProcessServiceTools } from "../src/modules/agent/processServiceTool.js";
import { createProcessTools } from "../src/modules/agent/processTool.js";
import { createServiceTools } from "../src/modules/agent/serviceTool.js";
import { estimateRequestTokens } from "../src/modules/agent/tokenEstimator.js";
import { TurnRunner } from "../src/modules/agent/turnRunner.js";
import { CommandManager } from "../src/modules/commands/manager.js";
import { createProject } from "../src/modules/projects/service.js";
import { ResourceEventBus } from "../src/modules/resources/events.js";
import { createSession, updateSession } from "../src/modules/sessions/service.js";
import { createTurn } from "../src/modules/sessions/turns.js";

type Profile = "coding" | "workspace";
type Step = { chunks: ProviderChunk[] };

const now = Date.now();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const tool = (id: string, name: string, args: unknown): Step => ({
  chunks: [
    { type: "tool-call", toolCall: { id, name, args } },
    { type: "finish", finishReason: "tool-calls" },
  ],
});
const text = (value: string): Step => ({
  chunks: [
    { type: "text-delta", text: value },
    { type: "finish", finishReason: "stop" },
  ],
});

interface Task {
  id: string;
  title: string;
  fixtures: Record<string, string>;
  steps: Step[];
}

const tasks: Task[] = [
  {
    id: "list-read",
    title: "列出目录并读取文件",
    fixtures: { "README.md": "fixture\n", "src/a.txt": "one\ntwo\n" },
    steps: [
      tool("t1", "list_files", { path: "." }),
      tool("t2", "read_file", { path: "src/a.txt" }),
      text("listed and read"),
    ],
  },
  {
    id: "search-read",
    title: "搜索代码并读取命中文件",
    fixtures: { "lib/c.txt": "gamma\n" },
    steps: [
      tool("t1", "search_code", { query: "gamma" }),
      tool("t2", "read_file", { path: "lib/c.txt" }),
      text("searched"),
    ],
  },
  {
    id: "create-file",
    title: "创建新文件并回读",
    fixtures: { "README.md": "fixture\n" },
    steps: [
      tool("t1", "write_file", { path: "src/new.txt", content: "hello\n" }),
      tool("t2", "read_file", { path: "src/new.txt" }),
      text("created"),
    ],
  },
  {
    id: "patch-file",
    title: "按版本补丁编辑文件",
    fixtures: { "src/a.txt": "one\ntwo\n" },
    steps: [
      tool("t1", "apply_patch", {
        path: "src/a.txt",
        expectedVersion: hash("one\ntwo\n"),
        patch: "--- a/src/a.txt\n+++ b/src/a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n",
      }),
      tool("t2", "read_file", { path: "src/a.txt" }),
      text("patched"),
    ],
  },
  {
    id: "run-command",
    title: "运行有限命令并读取输出",
    fixtures: { "README.md": "fixture\n" },
    steps: [
      tool("t1", "run_command", {
        executable: process.execPath,
        args: ["-e", "console.log('ab-command')"],
        cwd: ".",
      }),
      text("command done"),
    ],
  },
  {
    id: "run-shell",
    title: "运行平台 shell 命令",
    fixtures: { "README.md": "fixture\n" },
    steps: [
      tool("t1", "run_shell", {
        command: `"${process.execPath}" -e "console.log('ab-shell')"`,
        cwd: ".",
      }),
      text("shell done"),
    ],
  },
  {
    id: "multi-read",
    title: "并行读取多个文件",
    fixtures: { "src/a.txt": "one\n", "src/b.txt": "alpha\n", "lib/c.txt": "gamma\n" },
    steps: [
      tool("t1", "list_files", { path: "src" }),
      tool("t2", "read_file", { path: "src/b.txt" }),
      tool("t3", "read_file", { path: "lib/c.txt" }),
      text("multi read"),
    ],
  },
  {
    id: "create-patch",
    title: "创建后立即补丁",
    fixtures: { "README.md": "fixture\n" },
    steps: [
      tool("t1", "write_file", { path: "src/tmp.txt", content: "first\n" }),
      tool("t2", "apply_patch", {
        path: "src/tmp.txt",
        expectedVersion: hash("first\n"),
        patch: "--- a/src/tmp.txt\n+++ b/src/tmp.txt\n@@ -1 +1 @@\n-first\n+second\n",
      }),
      text("created and patched"),
    ],
  },
  {
    id: "command-streams",
    title: "命令退出码与输出",
    fixtures: { "README.md": "fixture\n" },
    steps: [
      tool("t1", "run_command", {
        executable: process.execPath,
        args: ["-e", "process.stdout.write('out');process.stderr.write('err')"],
        cwd: ".",
      }),
      text("command observed"),
    ],
  },
  {
    id: "mixed",
    title: "搜索、读取并写总结",
    fixtures: { "README.md": "TODO: check fixture\n", "notes/a.txt": "note\n" },
    steps: [
      tool("t1", "search_code", { query: "TODO" }),
      tool("t2", "read_file", { path: "README.md" }),
      tool("t3", "write_file", { path: "notes/summary.txt", content: "summary\n" }),
      text("mixed done"),
    ],
  },
];

interface TaskResult {
  id: string;
  title: string;
  profile: Profile;
  status: string;
  providerCalls: number;
  estimatedInputTokens: number;
  firstCallToolTokens: number;
  reportedTools: number;
  toolCalls: number;
  planEvents: number;
  toolFailures: number;
  failureCodes: string[];
  lockFailures: number;
  approvals: number;
  commands: number;
  commandFailed: number;
}

async function main(): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "larness-082-ab-"));
  const dataDir = path.join(dir, "data");
  await mkdir(dataDir, { recursive: true });
  const opened = openDatabase(path.join(dataDir, "larness.db"));
  const events = new ResourceEventBus();
  const commands = new CommandManager({
    db: opened.db,
    dataDir,
    events,
    idleTtlMinutes: 30,
  });
  try {
    runMigrations(opened.db);
    createBrowserSession(opened.db, {
      tokenHash: hash("kernel-ab-client"),
      kind: "once",
      createdAt: now,
      expiresAt: now + 3_600_000,
    });
    const clientSessionId = (
      opened.sqlite
        .prepare("SELECT id FROM browser_sessions WHERE token_hash = ?")
        .get(hash("kernel-ab-client")) as { id: string }
    ).id;

    const registry: ToolRegistry = createFileToolRegistry();
    for (const entry of [
      createPlanTool({ db: opened.db }),
      createCommandTool({}),
      createShellTool({}),
      ...createProcessTools({}),
      ...createProcessServiceTools({}),
      ...createServiceTools(),
      createObservationTool(),
    ])
      registry.register(entry);

    const results: TaskResult[] = [];
    for (const profile of ["coding", "workspace"] as const) {
      for (const task of tasks) {
        const root = path.join(dir, "projects", `${profile}-${task.id}`);
        await mkdir(path.join(root, "src"), { recursive: true });
        await mkdir(path.join(root, "lib"), { recursive: true });
        await mkdir(path.join(root, "notes"), { recursive: true });
        for (const [file, content] of Object.entries(task.fixtures)) {
          await writeFile(path.join(root, file), content);
        }
        const project = await createProject(
          { db: opened.db, detectGit: async () => false },
          { rootPath: root, name: `${profile}-${task.id}` },
        );
        const session = await createSession(
          { db: opened.db, dataDir },
          { projectId: project.id, agentProfile: profile, title: task.title },
        );
        updateSession(
          { db: opened.db, dataDir },
          { id: session.id, approvalPolicyId: "autonomous" },
        );
        const turn = createTurn(
          { db: opened.db },
          { sessionId: session.id, text: task.title, clientSessionId },
        );
        const provider = createFakeProvider(task.steps);
        const runner = new TurnRunner({
          db: opened.db,
          dataDir,
          registry,
          commands,
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });
        const result = await runner.run(turn.turnId);
        const first = provider.calls[0];
        const planEvents = (
          opened.sqlite
            .prepare(
              "SELECT count(*) AS n FROM agent_events WHERE turn_id = ? AND type = 'plan.updated'",
            )
            .get(turn.turnId) as { n: number }
        ).n;
        const approvals = (
          opened.sqlite
            .prepare("SELECT count(*) AS n FROM approvals WHERE turn_id = ?")
            .get(turn.turnId) as { n: number }
        ).n;
        const commandRows = opened.sqlite
          .prepare("SELECT status, reason_code FROM command_executions WHERE turn_id = ?")
          .all(turn.turnId) as { status: string; reason_code: string | null }[];
        const messages = provider.calls.flatMap((call) =>
          call.messages.map((message) => {
            if (message.role === "tool") {
              try {
                return JSON.parse(message.content) as { errorCode?: string; message?: string };
              } catch {
                return {};
              }
            }
            return {};
          }),
        );
        const failures = messages.filter((message) => message.errorCode !== undefined);
        results.push({
          id: task.id,
          title: task.title,
          profile,
          status: result.status,
          providerCalls: provider.calls.length,
          estimatedInputTokens: provider.calls.reduce(
            (sum, call) => sum + estimateRequestTokens(call.messages, call.tools),
            0,
          ),
          firstCallToolTokens: first === undefined ? 0 : estimateRequestTokens([], first.tools),
          reportedTools: first?.tools.length ?? 0,
          toolCalls: (
            opened.sqlite
              .prepare(
                "SELECT count(*) AS n FROM agent_events WHERE turn_id = ? AND type = 'tool.requested'",
              )
              .get(turn.turnId) as { n: number }
          ).n,
          planEvents,
          toolFailures: failures.length,
          failureCodes: failures.map((message) =>
            `${message.errorCode}: ${message.message ?? ""}`.trim(),
          ),
          lockFailures: failures.filter((message) => message.errorCode === "RESOURCE_LOCKED")
            .length,
          approvals,
          commands: commandRows.length,
          commandFailed: commandRows.filter((row) => row.status !== "COMPLETED").length,
        });
      }
    }

    const summarize = (profile: Profile) => {
      const rows = results.filter((row) => row.profile === profile);
      const sum = (pick: (row: TaskResult) => number) =>
        rows.reduce((total, row) => total + pick(row), 0);
      return {
        profile,
        tasks: rows.length,
        succeeded: rows.filter((row) => row.status === "COMPLETED").length,
        providerCalls: sum((row) => row.providerCalls),
        toolCalls: sum((row) => row.toolCalls),
        estimatedInputTokens: sum((row) => row.estimatedInputTokens),
        fixedToolTokensFirstCall: rows[0]?.firstCallToolTokens ?? 0,
        reportedTools: rows[0]?.reportedTools ?? 0,
        planEvents: sum((row) => row.planEvents),
        toolFailures: sum((row) => row.toolFailures),
        lockFailures: sum((row) => row.lockFailures),
        approvals: sum((row) => row.approvals),
        commands: sum((row) => row.commands),
        commandFailed: sum((row) => row.commandFailed),
      };
    };

    process.stdout.write(
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          mode: "deterministic-scripted",
          note: "Fake provider replays the same tool trace; this measures fixed context and functional success, not real-model quality.",
          summary: [summarize("coding"), summarize("workspace")],
          tasks: results,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await commands.close();
    opened.close();
    await rm(dir, { recursive: true, force: true });
  }
}

await main();
