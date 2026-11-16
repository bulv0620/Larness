import type { ModelMessage } from "@larness/agent";
import { estimateRequestTokens } from "../tokenEstimator.js";
import { foldToolResultContent } from "./toolResults.js";

/** Newest results stay verbatim so the model keeps working on real content. */
export const KEEP_RECENT_TOOL_RESULTS = 4;
/** A pinned batch larger than this is dropped instead of blowing the window. */
export const MAX_PINNED_TOOL_RESULTS = 10;
/** Share of the input window a pinned tool batch may occupy. */
export const MAX_PINNED_BATCH_SHARE = 0.25;

function isFolded(content: string): boolean {
  return content.includes('"folded":true');
}

/**
 * Level-1 compaction: older tool results keep only their identifiers. Nothing
 * is destroyed — the full result stays in `agent_events` — so this is the
 * cheapest way to buy room before an irreversible checkpoint.
 */
export function foldOldToolResults(messages: ModelMessage[]): ModelMessage[] | null {
  const indexes = messages.flatMap((message, index) => (message.role === "tool" ? [index] : []));

  if (indexes.length <= KEEP_RECENT_TOOL_RESULTS) {
    return null;
  }

  const next = [...messages];
  let changed = false;

  for (const index of indexes.slice(0, indexes.length - KEEP_RECENT_TOOL_RESULTS)) {
    const message = next[index];

    if (message?.role !== "tool" || isFolded(message.content)) {
      continue;
    }

    next[index] = { ...message, content: foldToolResultContent(message.content) };
    changed = true;
  }

  return changed ? next : null;
}

export interface PinnedBatch {
  messages: ModelMessage[];
  tokens: number;
}

/**
 * The most recent complete tool batch, folded. A checkpoint that keeps only the
 * facts forces the model to re-read everything it was just working on; keeping
 * one batch keeps the immediate working set without keeping the whole history.
 * Only a batch where every call has a result is returned, so the tool-call /
 * tool-result pairing a provider requires is never broken.
 */
export function lastCompleteToolBatch(
  messages: ModelMessage[],
  inputWindow: number,
): PinnedBatch | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role !== "assistant") {
      continue;
    }

    const calls = message.toolCalls ?? [];

    if (calls.length === 0) {
      continue;
    }

    if (calls.length > MAX_PINNED_TOOL_RESULTS) {
      return null;
    }

    const results = new Map<string, ModelMessage>();

    for (const entry of messages.slice(index + 1)) {
      if (entry.role === "tool") {
        results.set(entry.toolCallId, entry);
      }
    }

    const batch: ModelMessage[] = [message];

    for (const call of calls) {
      const result = results.get(call.id);

      if (result?.role !== "tool") {
        return null;
      }

      batch.push({ ...result, content: foldToolResultContent(result.content) });
    }

    const tokens = estimateRequestTokens(batch, []);

    if (inputWindow > 0 && tokens > Math.floor(inputWindow * MAX_PINNED_BATCH_SHARE)) {
      return null;
    }

    return { messages: batch, tokens };
  }

  return null;
}
