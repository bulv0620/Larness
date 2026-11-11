const MAX_TOOL_MESSAGE_CHARS = 20_000;
const MAX_TOOL_MESSAGE_LINES = 1_000;

export interface ToolResultLike {
  ok: boolean;
  summary: string;
  data?: unknown;
  errorCode?: string;
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

const MAX_TOOL_RESULT_CHARS = 16_000;
const TOOL_FIELD_CHARS = 4_000;
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
export function toolMessageContent(result: {
  ok: boolean;
  summary: string;
  data?: unknown;
  errorCode?: string;
}): string {
  const data = result.ok ? (result.data ?? { summary: result.summary }) : result.data;
  let budget = TOOL_FIELD_CHARS;

  for (let attempt = 0; attempt < 4; attempt += 1) {
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
