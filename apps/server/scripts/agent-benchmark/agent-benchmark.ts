import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createCompatibleProvider,
  createFileToolRegistry,
  type ProviderAdapter,
  type ProviderThinkingEffort,
} from "@larness/agent";
import type { ServerEvent } from "@larness/shared";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { browserSessions } from "../../src/db/schema.js";
import { createCommandTool, createShellTool } from "../../src/modules/agent/commandTool.js";
import { createPlanTool } from "../../src/modules/agent/planTool.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { CommandManager } from "../../src/modules/commands/manager.js";
import { createProject } from "../../src/modules/projects/service.js";
import { ResourceEventBus } from "../../src/modules/resources/events.js";
import { createSession, updateSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { type BenchmarkTask, seedTask, TASKS, taskById } from "./tasks.js";

const DEFAULT_MODEL = "deepseek-v4.1-flash";
const DEFAULT_ENDPOINT = "https://opencode.ai/inference/go/openai/v1";
const CONTEXT_WINDOW = 1_000_000;
const MAX_OUTPUT_TOKENS = 384_000;
const EFFORTS = new Set<ProviderThinkingEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

interface Options {
  taskId: string;
  outDir: string;
  dump: boolean;
  print: boolean;
}

function parseArgs(argv: string[]): Options {
  let taskId = "all";
  let outDir = "";
  let dump = false;
  let print = false;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--task") {
      taskId = argv[index + 1] ?? "";
      index += 1;
    } else if (value === "--out") {
      outDir = argv[index + 1] ?? "";
      index += 1;
    } else if (value === "--dump") {
      dump = true;
    } else if (value === "--print") {
      print = true;
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = process.env.INIT_CWD ?? process.cwd();
  return {
    taskId,
    outDir: path.resolve(outDir || path.join(root, "tmp", "agent-benchmark", stamp)),
    dump,
    print,
  };
}

function fakeAdapter(): ProviderAdapter {
  let calls = 0;

  return {
    id: "fake",
    capabilities: {
      streaming: true,
      toolCalls: true,
      vision: false,
      reasoning: false,
      maxContextTokens: CONTEXT_WINDOW,
    },
    async *streamStep() {
      calls += 1;

      if (calls === 1) {
        yield {
          type: "tool-call",
          toolCall: {
            id: "bench_test_before",
            name: "run_command",
            args: { executable: "node", args: ["--test"], cwd: "." },
          },
        };
        yield {
          type: "finish",
          finishReason: "tool-calls",
          usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
        };
        return;
      }

      if (calls === 2) {
        yield {
          type: "tool-call",
          toolCall: {
            id: "bench_edit",
            name: "edit",
            args: {
              path: "src/math.js",
              oldString: "return a - b;",
              newString: "return a + b;",
            },
          },
        };
        yield {
          type: "finish",
          finishReason: "tool-calls",
          usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
        };
        return;
      }

      if (calls === 3) {
        yield {
          type: "tool-call",
          toolCall: {
            id: "bench_test_after",
            name: "run_command",
            args: { executable: "node", args: ["--test"], cwd: "." },
          },
        };
        yield {
          type: "finish",
          finishReason: "tool-calls",
          usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
        };
        return;
      }

      yield { type: "text-delta", text: "done" };
      yield {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      };
    },
  };
}

function effortFromEnv(): ProviderThinkingEffort {
  const value = process.env.LARNESS_BENCH_EFFORT ?? "max";
  return EFFORTS.has(value as ProviderThinkingEffort) ? (value as ProviderThinkingEffort) : "max";
}

function tail(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : text.slice(-maxChars);
}

function run(
  cwd: string,
  command: string[],
): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(command[0] ?? "node", command.slice(1), {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  return {
    exitCode: result.status ?? 1,
    stdout: tail(result.stdout ?? "", 4_000),
    stderr: tail(result.stderr ?? "", 4_000),
  };
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return (result.stdout ?? "").trim();
}

function sumUsage(events: ServerEvent[]): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  steps: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let steps = 0;

  for (const event of events) {
    if (event.type !== "model.usage") continue;
    const payload = event.payload as {
      inputTokens?: unknown;
      outputTokens?: unknown;
      cacheReadTokens?: unknown;
    };
    steps += 1;
    if (typeof payload.inputTokens === "number") inputTokens += payload.inputTokens;
    if (typeof payload.outputTokens === "number") outputTokens += payload.outputTokens;
    if (typeof payload.cacheReadTokens === "number") cacheReadTokens += payload.cacheReadTokens;
  }

  return { inputTokens, outputTokens, cacheReadTokens, steps };
}

async function dumpRequest(
  file: string,
  task: BenchmarkTask,
  promptIndex: number,
  step: number,
  input: {
    model: string;
    messages: unknown;
    tools: Array<{ name: string; description: string; parameters: unknown }>;
    thinking?: unknown;
    maxOutputTokens?: number;
  },
): Promise<void> {
  await appendFile(
    file,
    `${JSON.stringify({
      task: task.id,
      promptIndex,
      step,
      model: input.model,
      thinking: input.thinking,
      maxOutputTokens: input.maxOutputTokens,
      tools: input.tools,
      messages: input.messages,
    })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
}

function seedBenchmarkClient(db: ReturnType<typeof openDatabase>["db"], now: number): void {
  db.insert(browserSessions)
    .values({
      id: "benchmark-client",
      tokenHash: `bench-${randomUUID()}`,
      kind: "once",
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + 24 * 60 * 60_000,
    })
    .run();
}

async function runTask(
  task: BenchmarkTask,
  options: Options,
  model: string,
  endpoint: string,
  effort: ProviderThinkingEffort,
  apiKey: string,
): Promise<{
  task: string;
  title: string;
  model: string;
  effort: string;
  prompts: Array<{
    prompt: string;
    status: string;
    durationMs: number;
    steps: number;
    toolCalls: number;
    toolFailures: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
  }>;
  verify: ReturnType<typeof run>;
  diffStat: string;
  gitStatus: string;
}> {
  const taskDir = path.join(options.outDir, task.id);
  const projectDir = path.join(taskDir, "project");
  const dataDir = path.join(taskDir, "data");
  await mkdir(projectDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  await seedTask(task, projectDir);

  git(projectDir, ["init", "-q"]);
  git(projectDir, ["add", "-A"]);
  git(projectDir, [
    "-c",
    "user.name=Larness Benchmark",
    "-c",
    "user.email=benchmark@example.invalid",
    "commit",
    "-q",
    "-m",
    "baseline",
  ]);
  git(projectDir, ["tag", "baseline"]);

  const opened = openDatabase(path.join(dataDir, "benchmark.db"));
  const events = new ResourceEventBus();
  let commands: CommandManager | null = null;

  try {
    runMigrations(opened.db);
    seedBenchmarkClient(opened.db, Date.now());
    const project = await createProject(
      { db: opened.db, detectGit: async () => true },
      { rootPath: projectDir },
    );
    const session = await createSession({ db: opened.db, dataDir }, { projectId: project.id });
    await updateSession(
      { db: opened.db, dataDir },
      { id: session.id, approvalPolicyId: "autonomous" },
    );
    const registry = createFileToolRegistry();
    registry.register(createPlanTool({ db: opened.db }));
    registry.register(createCommandTool({}));
    registry.register(createShellTool({}));
    commands = new CommandManager({
      db: opened.db,
      dataDir,
      events,
    });

    const requestsFile = path.join(taskDir, "requests.jsonl");
    const sessionHeader = `ses_${createHash("sha256")
      .update(JSON.stringify([task.id, model, endpoint]))
      .digest("hex")}`;
    let promptIndex = 0;
    let requestStep = 0;
    const fake = process.env.LARNESS_BENCH_FAKE === "1";
    const base = fake
      ? undefined
      : createCompatibleProvider({
          id: "opencode-go",
          name: "opencode-go",
          baseURL: endpoint,
          headers: { "x-opencode-session": sessionHeader },
        });
    const realAdapter: ProviderAdapter | undefined =
      base === undefined
        ? undefined
        : {
            id: base.id,
            capabilities: { ...base.capabilities, maxContextTokens: CONTEXT_WINDOW },
            async *streamStep(input) {
              requestStep += 1;

              if (options.dump) {
                await dumpRequest(requestsFile, task, promptIndex, requestStep, {
                  model,
                  messages: input.messages,
                  tools: input.tools,
                  thinking: input.thinking,
                  maxOutputTokens: input.maxOutputTokens,
                });
              }

              yield* base.streamStep(input);
            },
          };
    const adapter = fake ? fakeAdapter() : (realAdapter as ProviderAdapter);
    let published: ServerEvent[] = [];
    const runner = new TurnRunner({
      db: opened.db,
      dataDir,
      registry,
      commands,
      resolveProvider: () => ({
        adapter,
        model,
        apiKey,
        endpoint,
        contextWindow: CONTEXT_WINDOW,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinking: { enabled: true, effort },
      }),
      publish: (event) => {
        if ("type" in event) published.push(event);
      },
    });

    const promptResults: Array<{
      prompt: string;
      status: string;
      durationMs: number;
      steps: number;
      toolCalls: number;
      toolFailures: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
    }> = [];

    for (const prompt of task.prompts) {
      promptIndex += 1;
      requestStep = 0;
      published = [];

      const turn = createTurn(
        { db: opened.db },
        { sessionId: session.id, text: prompt, clientSessionId: "benchmark-client" },
      );
      const started = Date.now();
      const result = await runner.run(turn.turnId);
      const durationMs = Date.now() - started;
      promptResults.push({
        prompt,
        status: result.status,
        durationMs,
        ...sumUsage(published),
        toolCalls: published.filter((event) => event.type === "tool.requested").length,
        toolFailures: published.filter((event) => event.type === "tool.failed").length,
      });
    }

    const verify = run(projectDir, task.verify);
    const diffStat = git(projectDir, ["diff", "--stat"]);
    const gitStatus = git(projectDir, ["status", "--short"]);

    return {
      task: task.id,
      title: task.title,
      model,
      effort,
      prompts: promptResults,
      verify,
      diffStat,
      gitStatus,
    };
  } finally {
    await commands?.close();
    opened.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.print) {
    console.log(
      JSON.stringify(
        TASKS.map((task) => ({
          id: task.id,
          title: task.title,
          prompts: task.prompts,
          verify: task.verify,
          files: task.files.map((file) => file.path),
        })),
        null,
        2,
      ),
    );
    return;
  }

  const fake = process.env.LARNESS_BENCH_FAKE === "1";
  const apiKey = process.env.LARNESS_BENCH_API_KEY ?? (fake ? "fake" : undefined);

  if (!apiKey) {
    console.error(
      [
        "LARNESS_BENCH_API_KEY is required.",
        "Optional: LARNESS_BENCH_MODEL, LARNESS_BENCH_ENDPOINT, LARNESS_BENCH_EFFORT.",
        "Use --print to inspect the task manifest without a key.",
        "Use LARNESS_BENCH_FAKE=1 for an offline wiring smoke test (single-file-fix only).",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const model = process.env.LARNESS_BENCH_MODEL ?? DEFAULT_MODEL;
  const endpoint = process.env.LARNESS_BENCH_ENDPOINT ?? DEFAULT_ENDPOINT;
  const effort = effortFromEnv();
  const selected =
    options.taskId === "all"
      ? TASKS
      : [taskById(options.taskId)].filter((task): task is BenchmarkTask => task !== undefined);

  if (selected.length === 0) {
    console.error(
      `Unknown task: ${options.taskId}. Available: ${TASKS.map((task) => task.id).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(options.outDir, { recursive: true });
  const results: Awaited<ReturnType<typeof runTask>>[] = [];

  for (const task of selected) {
    console.log(`benchmark: ${task.id} (${task.title})`);
    const result = await runTask(task, options, model, endpoint, effort, apiKey);
    results.push(result);
    const prompt = result.prompts.at(-1);
    console.log(
      `  status=${prompt?.status ?? "unknown"} verify=${result.verify.exitCode} steps=${prompt?.steps ?? 0} ` +
        `toolCalls=${prompt?.toolCalls ?? 0} failures=${prompt?.toolFailures ?? 0} ` +
        `tokens=${(prompt?.inputTokens ?? 0) + (prompt?.outputTokens ?? 0)} durationMs=${prompt?.durationMs ?? 0}`,
    );
    await writeFile(
      path.join(options.outDir, task.id, "results.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }

  await writeFile(
    path.join(options.outDir, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  console.log(`results: ${path.join(options.outDir, "results.json")}`);
}

await main();
