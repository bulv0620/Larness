import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../apps/server/src/bootstrap/start.js";
import { connectIpc } from "../apps/server/src/ipc/client.js";
import type { ProviderResolver } from "../apps/server/src/modules/agent/turnRunner.js";
import { getProjectById } from "../apps/server/src/modules/projects/repository.js";
import { createFakeProvider, type ProviderChunk } from "../packages/agent/src/index.js";

const dataDir = mkdtempSync(path.join(tmpdir(), "larness-e2e-"));
const port = Number(process.env.LARNESS_E2E_PORT ?? 3210);
const publicUrl = process.env.LARNESS_E2E_PUBLIC_URL ?? "http://localhost:5173";
const password = "e2e admin password 123";

const root = fileURLToPath(new URL("..", import.meta.url));
const resultsDir = path.join(root, "test-results");
mkdirSync(resultsDir, { recursive: true });
writeFileSync(path.join(resultsDir, "e2e-data-dir"), dataDir);

function textStep(text: string): { chunks: ProviderChunk[] } {
  return {
    chunks: [
      { type: "text-delta", text },
      { type: "finish", finishReason: "stop" },
    ],
  };
}

function toolStep(toolCall: { id: string; name: string; args: unknown }): {
  chunks: ProviderChunk[];
} {
  return {
    chunks: [
      { type: "tool-call", toolCall },
      { type: "finish", finishReason: "tool-calls" },
    ],
  };
}

let running: Awaited<ReturnType<typeof startServer>>;

const fakeProviderResolver: ProviderResolver = async (session, turn) => {
  const input = (() => {
    try {
      return String((JSON.parse(turn.inputJson) as { text?: unknown }).text ?? "");
    } catch {
      return "";
    }
  })();

  if (input.includes("cancel")) {
    return {
      adapter: createFakeProvider([
        { delayMs: 8_000, chunks: [{ type: "text-delta", text: "late" }] },
      ]),
      model: "fake",
    };
  }

  if (input.includes("approve")) {
    const project =
      session.projectId === null ? null : getProjectById(running.db, session.projectId);
    const root = project?.realPath ?? session.workspacePath;

    try {
      const version = createHash("sha256")
        .update(readFileSync(path.join(root, "note.txt")))
        .digest("hex");
      return {
        adapter: createFakeProvider([
          toolStep({
            id: "call_patch",
            name: "apply_patch",
            args: {
              path: "note.txt",
              expectedVersion: version,
              patch: "--- a/note.txt\n+++ b/note.txt\n@@ -1 +1,2 @@\n seed\n+approved\n",
            },
          }),
          textStep("补丁已应用。"),
        ]),
        model: "fake",
      };
    } catch {
      return { adapter: createFakeProvider([textStep("找不到 note.txt。")]), model: "fake" };
    }
  }

  if (input.includes("list")) {
    return {
      adapter: createFakeProvider([
        toolStep({ id: "call_list", name: "list_files", args: { path: "." } }),
        textStep("项目文件已列出。"),
      ]),
      model: "fake",
    };
  }

  return { adapter: createFakeProvider([textStep("收到。")]), model: "fake" };
};

running = await startServer({
  env: {
    LARNESS_DATA_DIR: dataDir,
    LARNESS_PORT: String(port),
    LARNESS_PUBLIC_URL: publicUrl,
    LARNESS_LOG_LEVEL: "warn",
  },
  logDestination: process.stderr,
  providerResolver: fakeProviderResolver,
});

running.sqlite
  .prepare(
    "INSERT OR IGNORE INTO model_profiles (id, label, provider, model, credential_profile_id, endpoint, capabilities_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  )
  .run(
    "deepseek-alt",
    "DeepSeek Alt",
    "deepseek",
    "deepseek-chat",
    null,
    null,
    JSON.stringify({
      streaming: true,
      toolCalls: true,
      vision: false,
      reasoning: false,
      maxContextTokens: 128_000,
    }),
    Date.now(),
  );

const client = await connectIpc({ dataDir, client: "e2e-setup" });

try {
  await client.request("init.apply", {
    adminPassword: password,
    host: "127.0.0.1",
    port,
    publicUrl,
    channel: "stable",
  });
} finally {
  client.close();
}

console.log(`[e2e] server ready on ${port}; data dir ${dataDir}`);

const shutdown = async (): Promise<void> => {
  try {
    await running.shutdown("e2e");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  }
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

setInterval(() => undefined, 1 << 30);
