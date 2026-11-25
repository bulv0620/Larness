import { OutputRedactor } from "@larness/resources";

/**
 * Cross-Turn replay is bounded twice: per result (so one event cannot bloat the
 * event table) and per request (so a long session cannot replay its whole
 * working set). The values are backend constants, not user settings.
 */
export const MAX_REPLAY_CONTENT_CHARS = 16_000;
export const MAX_REPLAY_ARGS_CHARS = 2_000;
/** Share of the model window a request may spend replaying earlier results. */
export const REPLAY_RATIO = 0.05;
export const REPLAY_MIN_TOKENS = 2_000;
export const REPLAY_MAX_TOKENS = 32_000;
/** Older candidates are folded into identifiers until this share is used. */
export const REPLAY_FOLD_SHARE = 0.25;
export const MAX_FOLDED_REPLAY = 16;
/** Scan cap, not a conversational limit: the token budget trims the rest. */
export const MAX_REPLAY_EVENTS = 120;

export interface ToolReplayRecord {
  toolCallId: string;
  toolName: string;
  args: unknown;
  content: string;
  isError: boolean;
}

export function replayBudgetTokens(contextWindow: number): number {
  const window = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : 128_000;
  return Math.max(
    REPLAY_MIN_TOKENS,
    Math.min(REPLAY_MAX_TOKENS, Math.floor(window * REPLAY_RATIO)),
  );
}

/**
 * Only a small, serializable argument object is worth replaying: it is what the
 * provider needs to pair a synthesized assistant call with its tool result. A
 * call whose arguments are too large (a patch body, a file content) is skipped
 * rather than stored partially.
 */
function replayArgs(args: unknown): unknown | null {
  try {
    const json = JSON.stringify(args ?? {});
    if (json === undefined || json.length > MAX_REPLAY_ARGS_CHARS) return null;
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

function boundedContent(content: string): string | null {
  const redacted = new OutputRedactor([]).push(content, true);
  if (redacted.trim().length === 0) return null;
  if (redacted.length <= MAX_REPLAY_CONTENT_CHARS) return redacted;
  return `${redacted.slice(0, MAX_REPLAY_CONTENT_CHARS)}…[truncated for replay]`;
}

export function buildToolReplay(input: {
  toolCallId: string;
  toolName: string;
  args: unknown;
  content: string;
  isError?: boolean;
}): ToolReplayRecord | null {
  const args = replayArgs(input.args);
  if (args === null) return null;
  const content = boundedContent(input.content);
  if (content === null) return null;

  return {
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    args,
    content,
    isError: input.isError === true,
  };
}

export function parseToolReplay(payloadJson: string): ToolReplayRecord | null {
  try {
    const parsed = JSON.parse(payloadJson) as Record<string, unknown>;
    const toolCallId = parsed.toolCallId;
    const toolName = parsed.toolName;
    const content = parsed.content;

    if (
      typeof toolCallId !== "string" ||
      toolCallId.length === 0 ||
      typeof toolName !== "string" ||
      toolName.length === 0 ||
      typeof content !== "string" ||
      content.length === 0
    ) {
      return null;
    }

    return {
      toolCallId,
      toolName,
      args: parsed.args ?? {},
      content,
      isError: parsed.isError === true,
    };
  } catch {
    return null;
  }
}
