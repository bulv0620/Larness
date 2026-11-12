import type { ModelMessage, ToolSchema } from "@larness/agent";

/**
 * Character-cost model tuned for mixed Chinese/source/JSON payloads. A fixed
 * chars-per-token constant under-estimates CJK by roughly 3x, which is exactly
 * the case where a context overflow is least recoverable.
 */
const ASCII_CHARS_PER_TOKEN = 4;
const CJK_CHARS_PER_TOKEN = 1;
const OTHER_CHARS_PER_TOKEN = 2;
const MESSAGE_OVERHEAD_TOKENS = 4;

function isCjk(codePoint: number): boolean {
  return (
    (codePoint >= 0x3000 && codePoint <= 0x303f) ||
    (codePoint >= 0x3040 && codePoint <= 0x30ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef)
  );
}

export function estimateTextTokens(text: string): number {
  let ascii = 0;
  let cjk = 0;
  let other = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;

    if (codePoint < 0x80) {
      ascii += 1;
    } else if (isCjk(codePoint)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }

  return Math.ceil(
    ascii / ASCII_CHARS_PER_TOKEN + cjk / CJK_CHARS_PER_TOKEN + other / OTHER_CHARS_PER_TOKEN,
  );
}

function messageTokens(message: ModelMessage): number {
  let tokens = MESSAGE_OVERHEAD_TOKENS;

  switch (message.role) {
    case "system":
    case "user":
      tokens += estimateTextTokens(message.content);
      break;
    case "assistant":
      tokens += estimateTextTokens(message.content);
      tokens += estimateTextTokens(message.reasoning ?? "");
      if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
        tokens += estimateTextTokens(JSON.stringify(message.toolCalls));
      }
      break;
    case "tool":
      tokens += estimateTextTokens(message.content);
      break;
  }

  return tokens;
}

export function estimateRequestTokens(messages: ModelMessage[], tools: ToolSchema[] = []): number {
  const messageTotal = messages.reduce((total, message) => total + messageTokens(message), 0);
  const toolTotal =
    tools.length === 0 ? 0 : estimateTextTokens(JSON.stringify(tools)) + tools.length * 4;

  return Math.ceil(messageTotal + toolTotal);
}

/**
 * Anchor the heuristic to the provider's last reported input count. Messages
 * only grow inside a Turn, so the ratio of the two heuristics approximates the
 * unseen growth (tool results, assistant text) closely enough for a watermark.
 */
export function calibrateEstimate(options: {
  heuristicTokens: number;
  anchoredHeuristicTokens: number | undefined;
  anchoredProviderTokens: number | undefined;
}): number {
  const { heuristicTokens, anchoredHeuristicTokens, anchoredProviderTokens } = options;

  if (
    anchoredHeuristicTokens === undefined ||
    anchoredProviderTokens === undefined ||
    anchoredHeuristicTokens <= 0
  ) {
    return heuristicTokens;
  }

  const growth = Math.max(1, heuristicTokens) / anchoredHeuristicTokens;

  return Math.ceil(anchoredProviderTokens * growth);
}

export type ContextWatermark = "ok" | "soft" | "hard";

export const SOFT_WATERMARK_RATIO = 0.7;
export const HARD_WATERMARK_RATIO = 0.9;

export function contextWatermark(
  estimatedInputTokens: number,
  contextWindow: number,
): ContextWatermark {
  if (contextWindow <= 0) {
    return "hard";
  }

  const ratio = estimatedInputTokens / contextWindow;

  if (ratio >= HARD_WATERMARK_RATIO) {
    return "hard";
  }

  return ratio >= SOFT_WATERMARK_RATIO ? "soft" : "ok";
}

/**
 * Reserve room for the response so a request is never accepted by the provider
 * and then truncated mid-answer.
 */
const DEFAULT_OUTPUT_RESERVE = 8_192;

export function reservedOutputTokens(options: {
  maxOutputTokens: number;
  contextWindow: number;
}): number {
  // A configured cap bounds the reserve; without one we still reserve room for
  // the answer so the pre-check never accepts an over-window request.
  const cap = options.maxOutputTokens > 0 ? options.maxOutputTokens : DEFAULT_OUTPUT_RESERVE;

  return Math.min(cap, Math.max(0, Math.floor(options.contextWindow * 0.15)));
}
