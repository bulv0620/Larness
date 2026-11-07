import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDeepSeekProvider, type ProviderChunk } from "@larness/agent";
import Database from "better-sqlite3";
import { SecretStore } from "../src/security/secretStore.js";

const BASE_URL = "https://api.deepseek.com";
const TIMEOUT_MS = 90_000;

interface ChatResult {
  status: number;
  body: unknown;
}

interface SanitizedMessage {
  role?: string;
  hasReasoning: boolean;
  reasoningLength: number;
  toolCalls: string[];
  finishReason?: string;
  contentLength: number;
}

function dataDir(): string {
  const override = process.env.LARNESS_DATA_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(process.env.HOME ?? "", "Library", "Application Support", "larness");
}

function sanitize(payload: unknown): SanitizedMessage {
  const body = payload as {
    choices?: {
      message?: {
        role?: string;
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: { function?: { name?: string } }[];
      };
      finish_reason?: string;
    }[];
  };
  const choice = body.choices?.[0];
  const message = choice?.message;

  return {
    role: message?.role,
    hasReasoning:
      typeof message?.reasoning_content === "string" && message.reasoning_content.length > 0,
    reasoningLength:
      typeof message?.reasoning_content === "string" ? message.reasoning_content.length : 0,
    toolCalls: (message?.tool_calls ?? []).map((call) => call.function?.name ?? "?"),
    finishReason: choice?.finish_reason,
    contentLength: typeof message?.content === "string" ? message.content.length : 0,
  };
}

async function chat(apiKey: string, body: Record<string, unknown>): Promise<ChatResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = null;

    try {
      payload = JSON.parse(text);
    } catch {
      payload = { parseError: true, length: text.length };
    }

    return { status: response.status, body: payload };
  } finally {
    clearTimeout(timer);
  }
}

function errorSummary(result: ChatResult): string {
  const body = result.body as { error?: { message?: string; code?: string } } | null;
  const message = body?.error?.message ?? "";
  return `${result.status} ${body?.error?.code ?? ""} ${message.slice(0, 160)}`.trim();
}

function toolMessage(callId: string, value: string) {
  return { role: "tool", tool_call_id: callId, content: value };
}

function assistantMessage(
  content: string,
  toolCall: { id: string; name: string; args: string } | null,
  reasoning: string | null,
) {
  return {
    role: "assistant",
    content,
    ...(toolCall === null
      ? {}
      : {
          tool_calls: [
            {
              id: toolCall.id,
              type: "function",
              function: { name: toolCall.name, arguments: toolCall.args },
            },
          ],
        }),
    ...(reasoning === null ? {} : { reasoning_content: reasoning }),
  };
}

function pickToolCall(payload: unknown): { id: string; name: string; args: string } | null {
  const choices = (payload as { choices?: { message?: { tool_calls?: unknown[] } }[] }).choices;
  const call = choices?.[0]?.message?.tool_calls?.[0] as
    | { id?: string; function?: { name?: string; arguments?: string } }
    | undefined;

  if (call?.id === undefined || call.function?.name === undefined) {
    return null;
  }

  return { id: call.id, name: call.function.name, args: call.function.arguments ?? "{}" };
}

function reasoningOf(payload: unknown): string {
  const choices = (payload as { choices?: { message?: { reasoning_content?: string } }[] }).choices;
  return choices?.[0]?.message?.reasoning_content ?? "";
}

async function main(): Promise<void> {
  const dir = dataDir();
  const db = new Database(path.join(dir, "larness.db"), { readonly: true, fileMustExist: true });
  const credential = db
    .prepare(
      "SELECT id, label, secret_ref FROM credential_profiles WHERE provider = 'deepseek' ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
    .get() as { id: string; label: string; secret_ref: string } | undefined;

  if (credential === undefined) {
    throw new Error("no deepseek credential configured");
  }

  const secret = db
    .prepare("SELECT ciphertext, nonce, tag FROM secrets WHERE id = ?")
    .get(credential.secret_ref) as { ciphertext: string; nonce: string; tag: string } | undefined;
  const cache = db
    .prepare(
      "SELECT models_json FROM model_catalog_cache WHERE credential_profile_id = ? ORDER BY synced_at DESC LIMIT 1",
    )
    .get(credential.id) as { models_json: string } | undefined;
  db.close();

  if (secret === undefined) {
    throw new Error("credential secret is missing");
  }

  const store = await SecretStore.open(dir);
  const apiKey = store.decrypt(secret);

  const models =
    cache === undefined
      ? []
      : (JSON.parse(cache.models_json) as {
          id: string;
          label: string;
          thinking?: { supported?: boolean };
          default?: boolean;
        }[]);
  const model =
    models.find((item) => item.default) ??
    models.find((item) => item.thinking?.supported) ??
    models[0];

  if (model === undefined) {
    throw new Error("no cached catalog model; sync the catalog first");
  }

  const evidence: string[] = [];
  const record = (title: string, detail: string) => {
    evidence.push(`- ${title}：${detail}`);
  };

  const tools = [
    {
      type: "function",
      function: {
        name: "echo",
        description: "Echo a value back to the caller.",
        parameters: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    },
  ];
  // Thinking mode rejects a forced function tool_choice; use auto with an explicit prompt.
  const toolChoice = "auto";
  const system = "You are a tool-using test assistant. Always call the echo tool when asked.";
  const user =
    'Use the echo tool now. Call it exactly once with value "m5-1b"; do not answer without calling it.';

  const base = {
    model: model.id,
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    tools,
    tool_choice: toolChoice,
    stream: false,
  };

  record("model", `${model.id} (${model.label})`);

  const first = await chat(apiKey, {
    ...base,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const firstMessage = sanitize(first.body);
  record(
    "首次请求",
    first.status === 200
      ? `200 finish=${firstMessage.finishReason} tool=${firstMessage.toolCalls.join(",")} reasoning=${firstMessage.reasoningLength}B`
      : errorSummary(first),
  );

  const toolCall = pickToolCall(first.body);
  const reasoning = reasoningOf(first.body);

  if (first.status !== 200 || toolCall === null) {
    record("结论", "未能拿到工具调用，后续用例跳过");
  } else {
    const toolResult = "m5-1b";

    const withReasoning = await chat(apiKey, {
      ...base,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        assistantMessage("", toolCall, reasoning),
        toolMessage(toolCall.id, toolResult),
      ],
    });
    const withMessage = sanitize(withReasoning.body);
    record(
      "同轮续跑（回传 reasoning_content）",
      withReasoning.status === 200
        ? `200 finish=${withMessage.finishReason} content=${withMessage.contentLength}B`
        : errorSummary(withReasoning),
    );

    const withoutReasoning = await chat(apiKey, {
      ...base,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        assistantMessage("", toolCall, null),
        toolMessage(toolCall.id, toolResult),
      ],
    });
    record(
      "同轮续跑（省略 reasoning_content）",
      withoutReasoning.status === 200
        ? `200 finish=${sanitize(withoutReasoning.body).finishReason}`
        : errorSummary(withoutReasoning),
    );

    const emptyReasoning = await chat(apiKey, {
      ...base,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        assistantMessage("", toolCall, ""),
        toolMessage(toolCall.id, toolResult),
      ],
    });
    record(
      "同轮续跑（reasoning_content 为空串）",
      emptyReasoning.status === 200
        ? `200 finish=${sanitize(emptyReasoning.body).finishReason}`
        : errorSummary(emptyReasoning),
    );

    // Cross-turn: the previous assistant answer is history without reasoning.
    const crossTurn = await chat(apiKey, {
      ...base,
      tool_choice: "auto",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        assistantMessage("", toolCall, withReasoning.status === 200 ? reasoning : null),
        toolMessage(toolCall.id, toolResult),
        {
          role: "assistant",
          content:
            withReasoning.status === 200
              ? ((withReasoning.body as { choices?: { message?: { content?: string } }[] })
                  .choices?.[0]?.message?.content ?? "done")
              : "done",
        },
        { role: "user", content: "What value did the tool echo? Reply with only that value." },
      ],
    });
    record(
      "跨轮（历史不带 reasoning）",
      crossTurn.status === 200
        ? `200 finish=${sanitize(crossTurn.body).finishReason} content=${sanitize(crossTurn.body).contentLength}B`
        : errorSummary(crossTurn),
    );
  }

  // Streaming adapter path: exercises the exact code used by turns.
  const adapter = createDeepSeekProvider({ timeoutMs: 90_000 });
  const toolSchema = {
    name: "echo",
    description: "Echo a value back to the caller.",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    },
  } as const;
  const streamingChunks: ProviderChunk[] = [];
  const signal = AbortSignal.timeout(90_000);

  for await (const chunk of adapter.streamStep({
    model: model.id,
    apiKey,
    thinking: { enabled: true, effort: "high" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    tools: [toolSchema],
    signal,
  })) {
    streamingChunks.push(chunk);
    if (chunk.type === "error" || chunk.type === "finish") break;
  }

  const streamReasoning = streamingChunks
    .filter((chunk) => chunk.type === "reasoning-delta")
    .map((chunk) => chunk.text)
    .join("");
  const streamCall = streamingChunks.find((chunk) => chunk.type === "tool-call")?.toolCall;
  const streamError = streamingChunks.find((chunk) => chunk.type === "error");
  record(
    "流式适配器首步",
    streamError !== undefined
      ? `error=${streamError.error.code}`
      : `reasoning=${streamReasoning.length}B tool=${streamCall?.name ?? "none"}`,
  );

  if (streamCall !== undefined && streamError === undefined) {
    const followChunks: ProviderChunk[] = [];

    for await (const chunk of adapter.streamStep({
      model: model.id,
      apiKey,
      thinking: { enabled: true, effort: "high" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
        {
          role: "assistant",
          content: "",
          toolCalls: [streamCall],
          ...(streamReasoning.length === 0 ? {} : { reasoning: streamReasoning }),
        },
        { role: "tool", toolCallId: streamCall.id, toolName: streamCall.name, content: "m5-1b" },
      ],
      tools: [toolSchema],
      signal: AbortSignal.timeout(90_000),
    })) {
      followChunks.push(chunk);
      if (chunk.type === "error" || chunk.type === "finish") break;
    }

    const followError = followChunks.find((chunk) => chunk.type === "error");
    const followFinish = followChunks.find((chunk) => chunk.type === "finish");
    record(
      "流式适配器续跑",
      followError !== undefined
        ? `error=${followError.error.code}`
        : `finish=${followFinish?.finishReason ?? "?"}`,
    );
  }

  const markdown = [
    "# M5-1b 官方续跑 PoC（真实凭据）",
    "",
    `> 生成时间：${new Date().toISOString()}；数据目录：\`${dir}\`；密钥与推理正文未记录。`,
    "",
    ...evidence,
    "",
    "## 说明",
    "",
    "- 仅记录状态码、finish_reason、工具名与 reasoning 长度，不记录密钥、prompt 或推理正文。",
    "- 同轮续跑分别验证回传 reasoning_content、省略与空串三种请求。",
    "- 跨轮请求把上一轮 assistant 答复作为历史（不带 reasoning），验证是否仍可用。",
    "",
  ].join("\n");

  const out = fileURLToPath(
    new URL("../../../specs/061-deepseek-integration/poc-m5-1b.md", import.meta.url),
  );
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, markdown, "utf8");
  console.log(markdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
