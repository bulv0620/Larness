export interface Metrics {
  steps: number;
  toolCalls: number;
  toolFailures: number;
  /** Input tokens including provider cache reads. */
  promptTokens: number;
  nonCachedInputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface SideRun {
  side: "larness" | "opencode";
  metrics: Metrics;
  verify: number;
  diffStat: string;
  error?: string;
}

export interface SideSummary {
  rounds: number;
  verifyPass: number;
  steps: number | null;
  toolCalls: number | null;
  toolFailures: number | null;
  promptTokens: number | null;
  nonCachedInputTokens: number | null;
  cacheReadTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
}

export interface LarnessPromptResult {
  steps: number;
  toolCalls: number;
  toolFailures: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  durationMs: number;
}

export interface LarnessResult {
  prompts: LarnessPromptResult[];
  verify?: { exitCode?: number };
  diffStat?: string;
}

export interface OpenCodeMetrics {
  steps: number;
  toolCalls: number;
  toolFailures: number;
  inputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }

  const left = sorted[middle - 1];
  const right = sorted[middle];

  return left === undefined || right === undefined ? null : (left + right) / 2;
}

export function aggregateLarness(result: LarnessResult): Metrics {
  const metrics: Metrics = {
    steps: 0,
    toolCalls: 0,
    toolFailures: 0,
    promptTokens: 0,
    nonCachedInputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    durationMs: 0,
  };

  for (const prompt of result.prompts) {
    metrics.steps += prompt.steps;
    metrics.toolCalls += prompt.toolCalls;
    metrics.toolFailures += prompt.toolFailures;
    metrics.promptTokens += prompt.inputTokens;
    metrics.cacheReadTokens += prompt.cacheReadTokens ?? 0;
    metrics.outputTokens += prompt.outputTokens;
    metrics.durationMs += prompt.durationMs;
  }

  metrics.nonCachedInputTokens = metrics.promptTokens - metrics.cacheReadTokens;

  return metrics;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function extractSessionId(text: string): string | undefined {
  for (const line of text.split("\n")) {
    try {
      const event = JSON.parse(line) as { sessionID?: unknown };
      if (typeof event.sessionID === "string") return event.sessionID;
    } catch {
      // Ignore non-JSON log lines.
    }
  }

  return undefined;
}

export function parseOpenCodeJsonl(text: string): OpenCodeMetrics {
  const metrics: OpenCodeMetrics = {
    steps: 0,
    toolCalls: 0,
    toolFailures: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
  };
  const seenTools = new Set<string>();

  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;

    let event: unknown;

    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof event !== "object" || event === null) continue;

    const record = event as {
      type?: unknown;
      part?: {
        id?: unknown;
        tokens?: {
          input?: unknown;
          output?: unknown;
          reasoning?: unknown;
          cache?: { read?: unknown };
        };
        state?: { status?: unknown };
      };
    };

    if (record.type === "tool_use") {
      const id = typeof record.part?.id === "string" ? record.part.id : undefined;

      if (id !== undefined && seenTools.has(id)) continue;
      if (id !== undefined) seenTools.add(id);
      metrics.toolCalls += 1;

      if (record.part?.state?.status === "error") {
        metrics.toolFailures += 1;
      }
    } else if (record.type === "step_finish") {
      metrics.steps += 1;
      metrics.inputTokens += numberOrZero(record.part?.tokens?.input);
      metrics.outputTokens += numberOrZero(record.part?.tokens?.output);
      metrics.reasoningTokens += numberOrZero(record.part?.tokens?.reasoning);
      metrics.cacheReadTokens += numberOrZero(record.part?.tokens?.cache?.read);
    }
  }

  return metrics;
}

export function openCodeToMetrics(parsed: OpenCodeMetrics, durationMs: number): Metrics {
  return {
    steps: parsed.steps,
    toolCalls: parsed.toolCalls,
    toolFailures: parsed.toolFailures,
    promptTokens: parsed.inputTokens + parsed.cacheReadTokens,
    nonCachedInputTokens: parsed.inputTokens,
    cacheReadTokens: parsed.cacheReadTokens,
    outputTokens: parsed.outputTokens + parsed.reasoningTokens,
    durationMs,
  };
}

function metricMedian(runs: SideRun[], key: keyof Metrics): number | null {
  return median(runs.map((run) => run.metrics[key]));
}

export function summarizeSide(runs: SideRun[]): SideSummary | null {
  if (runs.length === 0) return null;

  return {
    rounds: runs.length,
    verifyPass: runs.filter((run) => run.verify === 0).length,
    steps: metricMedian(runs, "steps"),
    toolCalls: metricMedian(runs, "toolCalls"),
    toolFailures: metricMedian(runs, "toolFailures"),
    promptTokens: metricMedian(runs, "promptTokens"),
    nonCachedInputTokens: metricMedian(runs, "nonCachedInputTokens"),
    cacheReadTokens: metricMedian(runs, "cacheReadTokens"),
    outputTokens: metricMedian(runs, "outputTokens"),
    durationMs: metricMedian(runs, "durationMs"),
  };
}

export function formatMetric(value: number | null, digits = 0): string {
  if (value === null) return "—";
  return digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
}
