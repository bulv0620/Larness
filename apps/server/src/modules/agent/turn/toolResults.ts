import type { ModelMessage } from "@larness/agent";
import { estimateTextTokens } from "../tokenEstimator.js";

export const MAX_TOOL_MESSAGE_CHARS = 80_000;
export const MAX_TOOL_MESSAGE_LINES = 4_000;

export interface ToolIssue {
  path: string;
  message: string;
}

/**
 * Bounded, value-free validation issues. Without them a `tool.failed` event
 * only says "invalid tool arguments" and the cause is unrecoverable.
 */
export function toolFailureIssues(data: unknown, limit = 5): ToolIssue[] | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }

  const issues = (data as { issues?: unknown }).issues;

  if (!Array.isArray(issues) || issues.length === 0) {
    return undefined;
  }

  const bounded = issues.slice(0, limit).flatMap((issue) => {
    if (typeof issue !== "object" || issue === null) {
      return [];
    }

    const record = issue as { path?: unknown; message?: unknown };

    return [
      {
        path: typeof record.path === "string" ? record.path.slice(0, 200) : "",
        message: typeof record.message === "string" ? record.message.slice(0, 300) : "",
      },
    ];
  });

  return bounded.length > 0 ? bounded : undefined;
}

export interface ToolResultLike {
  ok: boolean;
  summary: string;
  data?: unknown;
  errorCode?: string;
  modelText?: string;
}

/**
 * A finite command's model-facing text: one status line plus the combined
 * output. stdout/stderr stay in `data` for the UI instead of being sent twice.
 */
export function commandModelText(input: {
  status: string;
  exitCode: number | null;
  shell?: string;
  output: string;
  truncated?: boolean;
}): string {
  const header = [
    `Command ${input.status}; exit code ${input.exitCode ?? "—"}`,
    input.shell === undefined ? undefined : `shell ${input.shell}`,
    input.truncated === true ? "output truncated" : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join("; ");

  return input.output.length === 0 ? header : `${header}\n${input.output}`;
}

export function truncateToolMessage(text: string): string {
  const lines = text.split(/\r?\n/);
  const limited = lines.slice(0, MAX_TOOL_MESSAGE_LINES).join("\n");
  return (
    limited.slice(0, MAX_TOOL_MESSAGE_CHARS) +
    (lines.length > MAX_TOOL_MESSAGE_LINES || limited.length > MAX_TOOL_MESSAGE_CHARS
      ? "...[truncated]"
      : "")
  );
}

export function boundedTerminalOutput(
  text: string,
  maxJsonChars = 12_000,
): {
  text: string;
  truncated: boolean;
} {
  let bounded = truncateToolMessage(text);
  while (JSON.stringify(bounded).length > maxJsonChars)
    bounded = `${bounded.slice(0, Math.max(1, Math.floor(bounded.length * 0.7)))}...[truncated]`;
  return { text: bounded, truncated: bounded !== text };
}

/**
 * A finite command's diagnostics live at the end (test summary, exit reason).
 * Keep the head and the tail instead of cutting only from the end.
 */
export function boundedCommandOutput(
  text: string,
  maxChars = 12_000,
): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= maxChars) return { text, truncated: false };

  const marker = `\n…[${text.length - maxChars} chars omitted]…\n`;
  const available = Math.max(2, maxChars - marker.length);
  const headChars = Math.floor(available * 0.6);
  const tailChars = available - headChars;
  const tail = tailChars > 0 ? text.slice(-tailChars) : "";

  return { text: `${text.slice(0, headChars)}${marker}${tail}`, truncated: true };
}

export const MAX_TOOL_RESULT_CHARS = 80_000;
/** Leave room for the envelope; one large field may use most of the budget. */
const INITIAL_FIELD_BUDGET = MAX_TOOL_RESULT_CHARS - 2_000;
const MAX_TOOL_ARRAY_ITEMS = 50;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shrinkString(value: string, maxChars: number): { text: string; omitted: number } {
  if (value.length <= maxChars) {
    return { text: value, omitted: 0 };
  }

  const omitted = value.length - maxChars;
  const marker = `\n…[${omitted} chars omitted]…\n`;
  const available = Math.max(2, maxChars - marker.length);
  const headChars = Math.max(1, Math.floor(available * 0.6));
  const tailChars = Math.max(0, available - headChars);
  const tail = tailChars === 0 ? "" : value.slice(-tailChars);

  return { text: `${value.slice(0, headChars)}${marker}${tail}`, omitted };
}

function shrinkValue(value: unknown, budget: number): { value: unknown; omitted: number } {
  if (typeof value === "string") {
    const shrunk = shrinkString(value, budget);
    return { value: shrunk.text, omitted: shrunk.omitted };
  }

  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_TOOL_ARRAY_ITEMS);
    let omitted = value.length - kept.length;
    const items = kept.map((item) => {
      const next = shrinkValue(item, budget);
      omitted += next.omitted;
      return next.value;
    });
    return { value: items, omitted };
  }

  if (isPlainRecord(value)) {
    let omitted = 0;
    const entries = Object.entries(value).map(([key, entry]) => {
      const next = shrinkValue(entry, budget);
      omitted += next.omitted;
      return [key, next.value] as const;
    });
    return { value: Object.fromEntries(entries), omitted };
  }

  return { value, omitted: 0 };
}

function withPage(value: unknown, omittedChars: number): unknown {
  const page = { truncated: true, omittedChars };
  return isPlainRecord(value) ? { ...value, page } : { value, page };
}

/**
 * Tool results must stay parseable: shrink content values first, then
 * serialize. A character cut of already-serialized JSON is never acceptable.
 */
function boundedModelText(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}...[truncated]`;
}

export function toolMessageContent(result: {
  ok: boolean;
  summary: string;
  data?: unknown;
  errorCode?: string;
  modelText?: string;
}): string {
  if (result.modelText !== undefined) {
    const text = boundedModelText(result.modelText);

    if (result.ok) {
      return text;
    }

    return `${result.errorCode ?? "TOOL_ERROR"}: ${result.summary}\n${text}`;
  }

  const data = result.ok ? (result.data ?? { summary: result.summary }) : result.data;
  let budget = INITIAL_FIELD_BUDGET;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const shrunk = shrinkValue(data, budget);
    const shaped = shrunk.omitted > 0 ? withPage(shrunk.value, shrunk.omitted) : shrunk.value;
    const payload = result.ok
      ? shaped
      : { errorCode: result.errorCode ?? "TOOL_ERROR", message: result.summary, data: shaped };
    const text = JSON.stringify(payload);

    if (text.length <= MAX_TOOL_RESULT_CHARS) {
      return text;
    }

    budget = Math.max(200, Math.floor(budget / 2));
  }

  return JSON.stringify(
    result.ok
      ? { summary: result.summary, page: { truncated: true, dataOmitted: true } }
      : {
          errorCode: result.errorCode ?? "TOOL_ERROR",
          message: result.summary,
          page: { truncated: true, dataOmitted: true },
        },
  );
}

/** Folded strings stay short enough to read as an identifier, not as content. */
const FOLD_STRING_CHARS = 160;
/** Plain-text model results keep their header (path/version/status) when folded. */
const FOLD_TEXT_CHARS = 400;
const FOLD_MAX_DEPTH = 3;

function foldValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return value.length <= FOLD_STRING_CHARS
      ? value
      : `…[${value.length - FOLD_STRING_CHARS} chars elided]…`;
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    // The count is what the model needs to judge a result, not the items.
    return { count: value.length };
  }

  if (isPlainRecord(value)) {
    if (depth >= FOLD_MAX_DEPTH) {
      return { keys: Object.keys(value).length };
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, foldValue(entry, depth + 1)]),
    );
  }

  return null;
}

/**
 * Replaces a tool result with its identifiers: paths, versions, counts and
 * status fields survive, bulk content is elided. This is reversible — the full
 * result is still in `agent_events` and the model can re-read the file — which
 * is why it is preferred over dropping history.
 */
export function foldToolResultContent(content: string): string {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    return JSON.stringify({ text: content.slice(0, FOLD_TEXT_CHARS), folded: true });
  }

  const base = isPlainRecord(parsed)
    ? (foldValue(parsed, 0) as Record<string, unknown>)
    : { value: foldValue(parsed, 0) };

  return JSON.stringify({ ...base, folded: true });
}

/**
 * One step can ask for several large results at once: six full 16k-character
 * results are roughly 24k tokens, which is most of a 128k window spent in a
 * single step and enough to push the Turn straight over the fold watermark. The
 * budget is generous, so an ordinary batch is untouched; only a pathological
 * one is folded, oldest first, which keeps the newest result verbatim — that is
 * the one the next step is most likely to act on. Folding is reversible: the
 * full results stay in `agent_events`.
 */
export const MAX_BATCH_TOOL_RESULT_TOKENS = 24_000;

export function foldBatchToolResults(
  messages: ModelMessage[],
  indexes: number[],
  budgetTokens: number,
): { messages: ModelMessage[]; folded: number } | null {
  const contents = indexes.flatMap((index) => {
    const message = messages[index];
    return message?.role === "tool" ? [message.content] : [];
  });

  if (contents.length < 2) return null;

  let remaining = contents.reduce((sum, content) => sum + estimateTextTokens(content), 0);

  if (remaining <= budgetTokens) return null;

  const next = [...messages];
  let folded = 0;

  for (const index of indexes.slice(0, -1)) {
    if (remaining <= budgetTokens) break;
    const message = next[index];
    if (message?.role !== "tool") continue;
    if (message.content.includes('"folded":true')) continue;
    const content = foldToolResultContent(message.content);
    const saved = estimateTextTokens(message.content) - estimateTextTokens(content);
    if (saved <= 0) continue;
    next[index] = { ...message, content };
    remaining -= saved;
    folded += 1;
  }

  return folded === 0 ? null : { messages: next, folded };
}
