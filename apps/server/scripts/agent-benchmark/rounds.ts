import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateLarness,
  extractSessionId,
  formatMetric,
  type LarnessResult,
  type Metrics,
  openCodeToMetrics,
  parseOpenCodeJsonl,
  type SideRun,
  type SideSummary,
  summarizeSide,
} from "./roundsLib.js";
import { type BenchmarkTask, TASKS, taskById } from "./tasks.js";

interface Options {
  rounds: number;
  taskId: string;
  outDir: string;
  opencode: boolean;
  opencodeBin: string;
  opencodeModel: string;
  model: string;
  effort: string;
  dump: boolean;
  timeoutMs: number;
}

interface RoundRecord {
  round: number;
  larness?: SideRun;
  opencode?: SideRun;
}

interface TaskRecord {
  task: string;
  title: string;
  rounds: RoundRecord[];
  summary: {
    larness: SideSummary | null;
    opencode: SideSummary | null;
  };
}

const DEFAULT_OPENCODE_BIN = "/Applications/OpenCode.app/Contents/Resources/opencode-cli";
const DEFAULT_MODEL = "deepseek-v4.1-flash";
const DEFAULT_EFFORT = "max";
const MAX_BUFFER = 64 * 1024 * 1024;

function parsePositiveInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseArgs(argv: string[]): Options {
  const root = process.env.INIT_CWD ?? process.cwd();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let model = process.env.LARNESS_BENCH_MODEL ?? DEFAULT_MODEL;
  let effort = process.env.LARNESS_BENCH_EFFORT ?? DEFAULT_EFFORT;
  let rounds = 3;
  let taskId = "all";
  let outDir = path.join(root, "tmp", "agent-benchmark", `rounds-${stamp}`);
  let opencode = false;
  let opencodeBin = DEFAULT_OPENCODE_BIN;
  let opencodeModel = `opencode-go/${model}#${effort}`;
  let dump = true;
  let timeoutMs = 600_000;

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index] ?? "";

    if (value === "--rounds") {
      rounds = parsePositiveInt(argv[index + 1] ?? "", rounds);
      index += 1;
    } else if (value === "--task") {
      taskId = argv[index + 1] ?? taskId;
      index += 1;
    } else if (value === "--out") {
      outDir = path.resolve(argv[index + 1] ?? outDir);
      index += 1;
    } else if (value === "--opencode") {
      opencode = true;
    } else if (value === "--opencode-bin") {
      opencodeBin = argv[index + 1] ?? opencodeBin;
      index += 1;
    } else if (value === "--opencode-model") {
      opencodeModel = argv[index + 1] ?? opencodeModel;
      index += 1;
    } else if (value === "--model") {
      const next = argv[index + 1] ?? model;
      model = next;
      opencodeModel = `opencode-go/${next}#${effort}`;
      index += 1;
    } else if (value === "--effort") {
      const next = argv[index + 1] ?? effort;
      effort = next;
      opencodeModel = `opencode-go/${model}#${next}`;
      index += 1;
    } else if (value === "--no-dump") {
      dump = false;
    } else if (value === "--timeout-ms") {
      timeoutMs = parsePositiveInt(argv[index + 1] ?? "", timeoutMs);
      index += 1;
    }
  }

  return {
    rounds: Math.min(rounds, 20),
    taskId,
    outDir,
    opencode,
    opencodeBin,
    opencodeModel,
    model,
    effort,
    dump,
    timeoutMs,
  };
}

function scriptRoot(): string {
  const fromEnv = process.env.INIT_CWD;
  if (fromEnv !== undefined && existsSync(path.join(fromEnv, "package.json"))) {
    return path.resolve(fromEnv);
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

function zeroMetrics(): Metrics {
  return {
    steps: 0,
    toolCalls: 0,
    toolFailures: 0,
    promptTokens: 0,
    nonCachedInputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };
}

function errorRun(side: SideRun["side"], error: string): SideRun {
  return { side, metrics: zeroMetrics(), verify: 1, diffStat: "", error };
}

function runProcess(
  command: string,
  args: string[],
  cwd: string,
  options: Options,
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof spawnSync> {
  return spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: options.timeoutMs,
    maxBuffer: MAX_BUFFER,
  });
}

async function runLarness(
  task: BenchmarkTask,
  taskDir: string,
  options: Options,
): Promise<SideRun> {
  const out = path.join(taskDir, "larness");
  await mkdir(out, { recursive: true });
  const args = [
    "--filter",
    "@larness/server",
    "exec",
    "tsx",
    "scripts/agent-benchmark/agent-benchmark.ts",
    "--task",
    task.id,
    "--out",
    out,
    ...(options.dump ? ["--dump"] : []),
  ];
  const child = runProcess("pnpm", args, scriptRoot(), options);

  const resultsFile = path.join(out, task.id, "results.json");

  if (!existsSync(resultsFile)) {
    return errorRun(
      "larness",
      `Larness produced no results (exit ${child.status ?? "unknown"}): ${String(child.stderr ?? "").slice(-500)}`,
    );
  }

  try {
    const value = JSON.parse(await readFile(resultsFile, "utf8")) as
      | LarnessResult
      | LarnessResult[];
    const result = Array.isArray(value) ? value[0] : value;

    if (result === undefined) {
      return errorRun("larness", "Larness results.json is empty");
    }

    return {
      side: "larness",
      metrics: aggregateLarness(result),
      verify: result.verify?.exitCode ?? 1,
      diffStat: result.diffStat ?? "",
      ...(child.status === 0 ? {} : { error: `Larness exited ${child.status ?? "unknown"}` }),
    };
  } catch (error) {
    return errorRun("larness", error instanceof Error ? error.message : String(error));
  }
}

function git(cwd: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function addMetrics(left: Metrics, right: Metrics): Metrics {
  return {
    steps: left.steps + right.steps,
    toolCalls: left.toolCalls + right.toolCalls,
    toolFailures: left.toolFailures + right.toolFailures,
    promptTokens: left.promptTokens + right.promptTokens,
    nonCachedInputTokens: left.nonCachedInputTokens + right.nonCachedInputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    durationMs: left.durationMs + right.durationMs,
  };
}

async function runOpenCode(
  task: BenchmarkTask,
  taskDir: string,
  sourceProject: string,
  options: Options,
): Promise<SideRun> {
  const out = path.join(taskDir, "opencode");
  const project = path.join(out, "project");
  await mkdir(out, { recursive: true });
  await cp(sourceProject, project, { recursive: true });

  const reset = git(project, ["reset", "--hard", "baseline"]);
  if (reset.status !== 0) {
    return errorRun("opencode", `cannot reset fixture to baseline: ${reset.stderr.slice(-500)}`);
  }
  git(project, ["clean", "-fd"]);

  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("OPENCODE")) delete env[key];
  }
  env.PWD = project;

  let session: string | undefined;
  let metrics = zeroMetrics();
  let error: string | undefined;

  for (const [index, prompt] of task.prompts.entries()) {
    const command = [
      options.opencodeBin,
      "--standalone",
      "run",
      "--auto",
      "--archived",
      "--format",
      "json",
      "--model",
      options.opencodeModel,
      ...(session === undefined ? [] : ["--session", session]),
      prompt,
    ];
    const started = Date.now();
    const child = runProcess(
      command[0] ?? options.opencodeBin,
      command.slice(1),
      project,
      options,
      env,
    );
    const durationMs = Date.now() - started;
    const output = String(child.stdout ?? "");
    const errorOutput = String(child.stderr ?? "");
    await writeFile(path.join(out, `prompt-${index + 1}.jsonl`), output, {
      encoding: "utf8",
      mode: 0o600,
    });
    await writeFile(path.join(out, `prompt-${index + 1}.stderr.log`), errorOutput, {
      encoding: "utf8",
      mode: 0o600,
    });

    const parsed = parseOpenCodeJsonl(output);
    metrics = addMetrics(metrics, openCodeToMetrics(parsed, durationMs));
    session ??= extractSessionId(output);

    if (child.status !== 0) {
      error = `opencode prompt ${index + 1} exited ${child.status ?? "unknown"}: ${errorOutput.slice(-300)}`;
    }
  }

  const verify = runProcess(task.verify[0] ?? "node", task.verify.slice(1), project, options);
  const diffStat = git(project, ["diff", "--stat"]).stdout.trim();

  return {
    side: "opencode",
    metrics,
    verify: verify.status ?? 1,
    diffStat,
    ...(error === undefined ? {} : { error }),
  };
}

function markdown(summary: {
  generatedAt: string;
  rounds: number;
  model: string;
  effort: string;
  tasks: TaskRecord[];
}): string {
  const lines = [
    "# Benchmark rounds",
    "",
    `- generated: ${summary.generatedAt}`,
    `- rounds: ${summary.rounds}`,
    `- model: ${summary.model}`,
    `- effort: ${summary.effort}`,
    "",
    "| Task | Side | Rounds | Verify | Steps | Calls | Failures | Prompt tokens | Non-cached | Output | Duration ms |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const task of summary.tasks) {
    for (const [side, value] of [
      ["Larness", task.summary.larness],
      ["opencode", task.summary.opencode],
    ] as const) {
      if (value === null) continue;
      lines.push(
        `| ${task.task} | ${side} | ${value.rounds} | ${value.verifyPass}/${value.rounds} | ${formatMetric(value.steps)} | ${formatMetric(value.toolCalls)} | ${formatMetric(value.toolFailures)} | ${formatMetric(value.promptTokens)} | ${formatMetric(value.nonCachedInputTokens)} | ${formatMetric(value.outputTokens)} | ${formatMetric(value.durationMs)} |`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function csv(summary: { tasks: TaskRecord[] }): string {
  const rows = [
    [
      "task",
      "side",
      "rounds",
      "verify_pass",
      "steps",
      "tool_calls",
      "tool_failures",
      "prompt_tokens",
      "non_cached_input_tokens",
      "cache_read_tokens",
      "output_tokens",
      "duration_ms",
    ].join(","),
  ];

  for (const task of summary.tasks) {
    for (const [side, value] of [
      ["larness", task.summary.larness],
      ["opencode", task.summary.opencode],
    ] as const) {
      if (value === null) continue;
      rows.push(
        [
          task.task,
          side,
          value.rounds,
          value.verifyPass,
          formatMetric(value.steps),
          formatMetric(value.toolCalls),
          formatMetric(value.toolFailures),
          formatMetric(value.promptTokens),
          formatMetric(value.nonCachedInputTokens),
          formatMetric(value.cacheReadTokens),
          formatMetric(value.outputTokens),
          formatMetric(value.durationMs),
        ].join(","),
      );
    }
  }

  return `${rows.join("\n")}\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const fake = process.env.LARNESS_BENCH_FAKE === "1";

  if (!fake && !process.env.LARNESS_BENCH_API_KEY) {
    throw new Error(
      "LARNESS_BENCH_API_KEY is required (or set LARNESS_BENCH_FAKE=1 for an offline smoke).",
    );
  }

  if (options.opencode && !existsSync(options.opencodeBin)) {
    throw new Error(
      `opencode CLI not found at ${options.opencodeBin}; pass --opencode-bin <path>.`,
    );
  }

  const selected =
    options.taskId === "all"
      ? TASKS
      : [taskById(options.taskId)].filter((task): task is BenchmarkTask => task !== undefined);

  if (selected.length === 0) {
    throw new Error(
      `Unknown task: ${options.taskId}. Available: ${TASKS.map((task) => task.id).join(", ")}`,
    );
  }

  await mkdir(options.outDir, { recursive: true });
  const tasks: TaskRecord[] = [];

  for (const task of selected) {
    const taskRecord: TaskRecord = {
      task: task.id,
      title: task.title,
      rounds: [],
      summary: { larness: null, opencode: null },
    };

    for (let round = 1; round <= options.rounds; round += 1) {
      const roundDir = path.join(
        options.outDir,
        `round-${String(round).padStart(2, "0")}`,
        task.id,
      );
      console.log(`[round ${round}/${options.rounds}] ${task.id}`);

      const larness = await runLarness(task, roundDir, options);
      let opencode: SideRun | undefined;

      if (options.opencode) {
        const sourceProject = path.join(roundDir, "larness", task.id, "project");
        if (existsSync(sourceProject)) {
          opencode = await runOpenCode(task, roundDir, sourceProject, options);
        } else {
          opencode = errorRun("opencode", "Larness project is missing; opencode skipped");
        }
      }

      taskRecord.rounds.push({ round, larness, ...(opencode === undefined ? {} : { opencode }) });
      const current = taskRecord.rounds.at(-1);
      console.log(
        `  larness verify=${larness.verify} steps=${larness.metrics.steps} calls=${larness.metrics.toolCalls} tokens=${larness.metrics.promptTokens + larness.metrics.outputTokens}` +
          (opencode === undefined
            ? ""
            : ` | opencode verify=${opencode.verify} steps=${opencode.metrics.steps} calls=${opencode.metrics.toolCalls} tokens=${opencode.metrics.promptTokens + opencode.metrics.outputTokens}`),
      );
      if (current === undefined) throw new Error("round record missing");
    }

    const larnessRuns = taskRecord.rounds.flatMap((round) =>
      round.larness === undefined ? [] : [round.larness],
    );
    const opencodeRuns = taskRecord.rounds.flatMap((round) =>
      round.opencode === undefined ? [] : [round.opencode],
    );
    taskRecord.summary.larness = summarizeSide(larnessRuns);
    taskRecord.summary.opencode = summarizeSide(opencodeRuns);
    tasks.push(taskRecord);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    rounds: options.rounds,
    model: options.model,
    effort: options.effort,
    opencodeModel: options.opencode ? options.opencodeModel : null,
    tasks,
  };

  await writeFile(
    path.join(options.outDir, "rounds.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  await writeFile(
    path.join(options.outDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  await writeFile(path.join(options.outDir, "summary.md"), markdown(summary), {
    encoding: "utf8",
    mode: 0o600,
  });
  await writeFile(path.join(options.outDir, "summary.csv"), csv(summary), {
    encoding: "utf8",
    mode: 0o600,
  });

  console.log(`results: ${path.join(options.outDir, "summary.md")}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
