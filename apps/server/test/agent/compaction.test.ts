import type { ModelMessage } from "@larness/agent";
import { describe, expect, it } from "vitest";
import {
  foldOldToolResults,
  KEEP_RECENT_TOOL_RESULTS,
  lastCompleteToolBatch,
} from "../../src/modules/agent/turn/compaction.js";
import {
  foldBatchToolResults,
  foldToolResultContent,
  MAX_BATCH_TOOL_RESULT_TOKENS,
} from "../../src/modules/agent/turn/toolResults.js";

function readResult(filePath: string, body: string): string {
  return JSON.stringify({ path: filePath, version: "v1", content: body, totalLines: 10 });
}

function toolMessage(toolCallId: string, content: string): ModelMessage {
  return { role: "tool", toolCallId, toolName: "read_file", content };
}

function readCall(id: string, filePath: string): ModelMessage {
  return {
    role: "assistant",
    content: "",
    toolCalls: [{ id, name: "read_file", args: { path: filePath } }],
  };
}

describe("tool result folding", () => {
  it("keeps identifiers and counts while eliding bulk content", () => {
    const folded = foldToolResultContent(readResult("src/a.ts", "x".repeat(5_000)));

    expect(folded).toContain('"folded":true');
    expect(folded).toContain("src/a.ts");
    expect(folded).toContain("v1");
    expect(folded).toContain("totalLines");
    expect(folded.length).toBeLessThan(400);
    expect(() => JSON.parse(folded)).not.toThrow();
  });

  it("folds arrays to their count instead of dropping them", () => {
    const folded = foldToolResultContent(
      JSON.stringify({ matches: [{ line: 1 }, { line: 2 }, { line: 3 }], scannedFiles: 9 }),
    );

    expect(JSON.parse(folded)).toMatchObject({ matches: { count: 3 }, scannedFiles: 9 });
  });

  it("leaves already small results recognisable", () => {
    const folded = foldToolResultContent(JSON.stringify({ path: "a.ts", version: "v1" }));

    expect(JSON.parse(folded)).toMatchObject({ path: "a.ts", version: "v1", folded: true });
  });

  it("folds plain-text model results with a visible marker", () => {
    const folded = foldToolResultContent(
      ["src/a.ts", "version: v1", "1: one", "2: two", "x".repeat(5_000)].join("\n"),
    );

    expect(folded).toContain('"folded":true');
    expect(folded).toContain("src/a.ts");
    expect(folded.length).toBeLessThan(600);
    expect(() => JSON.parse(folded)).not.toThrow();
  });
});

describe("history folding", () => {
  it("folds only results older than the recent window", () => {
    const messages: ModelMessage[] = [{ role: "system", content: "policy" }];

    for (let index = 0; index < KEEP_RECENT_TOOL_RESULTS + 3; index += 1) {
      messages.push(readCall(`call_${index}`, `src/${index}.ts`));
      messages.push(toolMessage(`call_${index}`, readResult(`src/${index}.ts`, "y".repeat(900))));
    }

    const folded = foldOldToolResults(messages);

    expect(folded).not.toBeNull();
    const toolContents = (folded ?? []).flatMap((message) =>
      message.role === "tool" ? [message.content] : [],
    );
    const foldedCount = toolContents.filter((content) => content.includes('"folded":true')).length;
    const intactCount = toolContents.length - foldedCount;

    expect(foldedCount).toBe(3);
    expect(intactCount).toBe(KEEP_RECENT_TOOL_RESULTS);
    // The newest result is byte-identical, so the working set stays readable.
    expect(toolContents.at(-1)).toBe(
      messages.at(-1)?.role === "tool" ? messages.at(-1)?.content : undefined,
    );
  });

  it("does nothing when there are too few results to bother", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "policy" },
      readCall("call_0", "a.ts"),
      toolMessage("call_0", readResult("a.ts", "z")),
    ];

    expect(foldOldToolResults(messages)).toBeNull();
  });
});

describe("retained tool batch", () => {
  it("returns the last complete batch with its pairing intact", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "policy" },
      readCall("old", "old.ts"),
      toolMessage("old", readResult("old.ts", "a")),
      readCall("new", "new.ts"),
      toolMessage("new", readResult("new.ts", "b")),
      { role: "user", content: "wrap up" },
    ];

    const batch = lastCompleteToolBatch(messages, 10_000);

    expect(batch?.messages).toHaveLength(2);
    expect(batch?.messages[0]?.role).toBe("assistant");
    expect(batch?.messages[1]?.role).toBe("tool");
    if (batch?.messages[0]?.role === "assistant" && batch.messages[1]?.role === "tool") {
      expect(batch.messages[0].toolCalls?.[0]?.id).toBe(batch.messages[1].toolCallId);
    }
  });

  it("refuses a batch whose results are not all present", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "policy" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "a", name: "read_file", args: { path: "a.ts" } },
          { id: "b", name: "read_file", args: { path: "b.ts" } },
        ],
      },
      toolMessage("a", readResult("a.ts", "x")),
    ];

    expect(lastCompleteToolBatch(messages, 10_000)).toBeNull();
  });

  it("refuses a batch whose request arguments alone would fill the window", () => {
    // Folding only shrinks results; call arguments stay verbatim because a
    // half-visible patch is worse than no patch, so such a batch is dropped.
    const messages: ModelMessage[] = [
      { role: "system", content: "policy" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "a", name: "write_file", args: { path: "a.ts", content: "x".repeat(40_000) } },
        ],
      },
      toolMessage("a", readResult("a.ts", "x")),
    ];

    expect(lastCompleteToolBatch(messages, 1_000)).toBeNull();
  });
});

describe("tool batch budget", () => {
  function batch(
    count: number,
    bodyChars: number,
  ): {
    messages: ModelMessage[];
    indexes: number[];
  } {
    const messages: ModelMessage[] = [{ role: "system", content: "policy" }];
    const indexes: number[] = [];

    for (let index = 0; index < count; index += 1) {
      indexes.push(messages.length);
      messages.push(
        toolMessage(`call_${index}`, readResult(`src/${index}.ts`, "y".repeat(bodyChars))),
      );
    }

    return { messages, indexes };
  }

  it("folds the oldest results and keeps the newest one verbatim", () => {
    const { messages, indexes } = batch(4, 8_000);
    const newest = messages.at(-1);

    const bounded = foldBatchToolResults(messages, indexes, 6_000);

    expect(bounded).not.toBeNull();
    const contents = (bounded?.messages ?? []).flatMap((message) =>
      message.role === "tool" ? [message.content] : [],
    );

    expect(bounded?.folded).toBeGreaterThan(0);
    expect(contents[0]).toContain('"folded":true');
    expect(contents[0]).toContain("src/0.ts");
    // The newest result is what the next step acts on, so it is never folded.
    expect(contents.at(-1)).toBe(newest?.role === "tool" ? newest.content : undefined);
  });

  it("leaves an ordinary batch untouched", () => {
    const { messages, indexes } = batch(3, 900);

    expect(foldBatchToolResults(messages, indexes, MAX_BATCH_TOOL_RESULT_TOKENS)).toBeNull();
  });

  it("does nothing for a single result", () => {
    const { messages, indexes } = batch(1, 200_000);

    expect(foldBatchToolResults(messages, indexes, 1_000)).toBeNull();
  });
});
