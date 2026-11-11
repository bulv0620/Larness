import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../apps/server/src/bootstrap/start.js";
import { connectIpc } from "../apps/server/src/ipc/client.js";
import type { ProviderResolver } from "../apps/server/src/modules/agent/turnRunner.js";
import { refreshModelCatalog } from "../apps/server/src/modules/models/catalog.js";
import { createCredential } from "../apps/server/src/modules/models/service.js";
import { getProjectById } from "../apps/server/src/modules/projects/repository.js";
import { SecretStore } from "../apps/server/src/security/secretStore.js";
import { createFakeProvider, type ProviderChunk } from "../packages/agent/src/index.js";
import { DEFAULT_APP_CONFIG } from "../packages/shared/src/index.js";

const dataDir = mkdtempSync(path.join(tmpdir(), "larness-e2e-"));
const previewPort = Number(process.env.LARNESS_E2E_PREVIEW_PORT ?? 3211);
writeFileSync(
  path.join(dataDir, "config.json"),
  `${JSON.stringify(
    { ...DEFAULT_APP_CONFIG, preview: { enabled: true, port: previewPort } },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
const port = Number(process.env.LARNESS_E2E_PORT ?? 3210);
const publicUrl = process.env.LARNESS_E2E_PUBLIC_URL ?? "http://localhost:5173";

const root = fileURLToPath(new URL("..", import.meta.url));
const resultsDir = path.join(root, "test-results");
mkdirSync(resultsDir, { recursive: true });
writeFileSync(path.join(resultsDir, "e2e-data-dir"), dataDir);

function textStep(text: string): { chunks: ProviderChunk[] } {
  return {
    chunks: [
      { type: "text-delta", text },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 12_000, outputTokens: 800, totalTokens: 12_800 },
      },
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

  if (input === "conversation plan" || input === "conversation plan cancel") {
    const step = (done: number) =>
      toolStep({
        id: `plan_${done}`,
        name: "update_plan",
        args: {
          title: "检查项目",
          steps: [
            { id: "inspect", title: "检查文件", status: done > 0 ? "done" : "running" },
            {
              id: "verify",
              title: "验证结果",
              status: done === 2 ? "done" : done === 1 ? "running" : "pending",
            },
          ],
        },
      });
    if (input === "conversation plan cancel") {
      return {
        adapter: createFakeProvider([step(0), { ...step(2), delayMs: 15_000 }]),
        model: turn.model ?? "deepseek-flash",
        contextWindow: 1_048_576,
      };
    }
    return {
      adapter: createFakeProvider([
        step(0),
        { ...toolStep({ id: "inspect", name: "list_files", args: { path: "." } }), delayMs: 1500 },
        step(1),
        // Keep the active plan visible long enough for slower hosts to observe
        // the running state before the final text arrives.
        { ...step(2), delayMs: 8_000 },
        textStep(
          Array.from(
            { length: 60 },
            (_, index) =>
              `历史段落 ${index + 1}：已读取工作区文件，这是用于验证长对话阅读位置的测试记录。`,
          ).join("\n\n") + "\n\n计划验证结束。",
        ),
      ]),
      model: turn.model ?? "deepseek-flash",
      contextWindow: 1_048_576,
    };
  }

  if (input.startsWith("dev ")) {
    return {
      adapter: createFakeProvider([
        {
          chunks: [
            {
              type: "tool-call",
              toolCall: {
                id: "dev-frontend",
                name: "start_project_terminal",
                args: {
                  role: "frontend",
                  executable: process.execPath,
                  args: ["-e", "process.stdout.write('FRONT_READY\\n');setInterval(()=>{},1000)"],
                },
              },
            },
            {
              type: "tool-call",
              toolCall: {
                id: "dev-backend",
                name: "start_project_terminal",
                args: {
                  role: "backend",
                  executable: process.execPath,
                  args: ["-e", "process.stdout.write('BACK_READY\\n');setInterval(()=>{},1000)"],
                },
              },
            },
            { type: "finish", finishReason: "tool-calls" },
          ],
        },
        textStep("开发终端已启动。"),
      ]),
      model: turn.model ?? "deepseek-flash",
      contextWindow: 1_048_576,
    };
  }

  if (input.startsWith("vite start ")) {
    const port = Number(input.split(" ").at(-1));
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return {
        adapter: createFakeProvider([textStep("invalid vite port")]),
        model: turn.model ?? "deepseek-flash",
        contextWindow: 1_048_576,
      };
    const viteBin = path.join(root, "apps/web/node_modules/vite/bin/vite.js");
    return {
      adapter: createFakeProvider([
        {
          chunks: [
            {
              type: "tool-call",
              toolCall: {
                id: "vite-frontend",
                name: "start_project_terminal",
                args: {
                  role: "frontend",
                  executable: process.execPath,
                  args: [viteBin, "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
                },
              },
            },
            { type: "finish", finishReason: "tool-calls" },
          ],
        },
        textStep("开发终端已启动。"),
      ]),
      model: turn.model ?? "deepseek-flash",
      contextWindow: 1_048_576,
    };
  }

  if (input.startsWith("service start ")) {
    const port = Number(input.split(" ").at(-1));
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      return {
        adapter: createFakeProvider([textStep("invalid service port")]),
        model: turn.model ?? "deepseek-flash",
        contextWindow: 1_048_576,
      };
    return {
      adapter: createFakeProvider([
        {
          chunks: [
            {
              type: "tool-call",
              toolCall: {
                id: "service-frontend",
                name: "start_project_terminal",
                args: {
                  role: "backend",
                  executable: process.execPath,
                  args: [
                    "-e",
                    `require("node:http").createServer((request, response) => response.end("ok")).listen(${port}, "127.0.0.1", () => console.log("SERVICE_READY"));`,
                  ],
                },
              },
            },
            { type: "finish", finishReason: "tool-calls" },
          ],
        },
        textStep("开发终端已启动。"),
      ]),
      model: turn.model ?? "deepseek-flash",
      contextWindow: 1_048_576,
    };
  }

  if (input === "preview service") {
    const projectId = session.projectId;
    const service =
      projectId === null
        ? undefined
        : (running.sqlite
            .prepare(
              "SELECT id FROM services WHERE project_id = ? AND status = 'RUNNING' ORDER BY created_at DESC LIMIT 1",
            )
            .get(projectId) as { id: string } | undefined);
    if (!service)
      return {
        adapter: createFakeProvider([textStep("暂无可预览服务。")]),
        model: turn.model ?? "deepseek-flash",
        contextWindow: 1_048_576,
      };
    return {
      adapter: createFakeProvider([
        toolStep({
          id: "preview-service",
          name: "resolve_service_preview",
          args: { serviceId: service.id, path: "/" },
        }),
        textStep("预览已就绪。"),
      ]),
      model: turn.model ?? "deepseek-flash",
      contextWindow: 1_048_576,
    };
  }

  if (input === "ai control") {
    const projectId = session.projectId;
    const terminal =
      projectId === null
        ? undefined
        : (running.sqlite
            .prepare(
              "SELECT id FROM terminals WHERE project_id = ? AND role = 'frontend' AND status = 'RUNNING' ORDER BY created_at DESC LIMIT 1",
            )
            .get(projectId) as { id: string } | undefined);
    if (!terminal)
      return {
        adapter: createFakeProvider([textStep("no terminal")]),
        model: turn.model ?? "deepseek-flash",
        contextWindow: 1_048_576,
      };
    const lease = running.sqlite
      .prepare("SELECT generation FROM terminal_leases WHERE terminal_id = ?")
      .get(terminal.id) as { generation: number } | undefined;
    const nextGeneration = (lease?.generation ?? 0) + 1;
    return {
      adapter: createFakeProvider([
        toolStep({
          id: "acquire-control",
          name: "acquire_terminal_control",
          args: { terminalId: terminal.id },
        }),
        {
          delayMs: 10_000,
          chunks: [
            {
              type: "tool-call",
              toolCall: {
                id: "stale-input",
                name: "send_terminal_input",
                args: {
                  terminalId: terminal.id,
                  leaseGeneration: nextGeneration,
                  inputSequence: 1,
                  data: "printf 'STALE\\n'\n",
                },
              },
            },
            { type: "finish", finishReason: "tool-calls" },
          ],
        },
        textStep("done"),
      ]),
      model: turn.model ?? "deepseek-flash",
      contextWindow: 1_048_576,
    };
  }

  if (input.startsWith("command ")) {
    const code = input.includes("cancel")
      ? "const fs=require('node:fs');let n=0;console.log('running '+'.'.repeat(300));setInterval(()=>fs.writeFileSync('ticks',String(++n)),100)"
      : "require('node:fs').appendFileSync('command-effect','once');process.stdout.write('public start '+'.'.repeat(300)+'\\n');process.stderr.write('token=fixture-command-secret\\n');setTimeout(()=>{console.log('public finish');process.exitCode=7},6000)";
    return {
      adapter: createFakeProvider([
        toolStep({
          id: "call_command",
          name: "run_command",
          args: { executable: process.execPath, args: ["-e", code], timeoutMs: 10000 },
        }),
        textStep("命令结果已读取。"),
      ]),
      model: turn.model ?? "deepseek-flash",
      contextWindow: 1_048_576,
    };
  }

  if (input.includes("cancel")) {
    return {
      adapter: createFakeProvider([
        { delayMs: 8_000, chunks: [{ type: "text-delta", text: "late" }] },
      ]),
      model: turn.model ?? "deepseek-flash",
      contextWindow: 1_048_576,
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
        model: turn.model ?? "deepseek-flash",
        contextWindow: 1_048_576,
      };
    } catch {
      return {
        adapter: createFakeProvider([textStep("找不到 note.txt。")]),
        model: turn.model ?? "deepseek-flash",
        contextWindow: 1_048_576,
      };
    }
  }

  if (input.includes("list")) {
    return {
      adapter: createFakeProvider([
        {
          chunks: [
            { type: "text-delta", text: "我先看一下。" },
            {
              type: "tool-call",
              toolCall: { id: "call_list", name: "list_files", args: { path: "." } },
            },
            { type: "finish", finishReason: "tool-calls" },
          ],
        },
        textStep("项目文件已列出。"),
      ]),
      model: turn.model ?? "deepseek-flash",
      contextWindow: 1_048_576,
    };
  }

  return {
    adapter: createFakeProvider([textStep("收到。")]),
    model: turn.model ?? "deepseek-flash",
    contextWindow: 1_048_576,
  };
};

const catalogFetcher = async () => ({
  data: [{ id: "deepseek-flash" }, { id: "deepseek-chat" }],
});

running = await startServer({
  env: {
    LARNESS_DATA_DIR: dataDir,
    LARNESS_PORT: String(port),
    LARNESS_PUBLIC_URL: publicUrl,
    LARNESS_LOG_LEVEL: "warn",
  },
  logDestination: process.stderr,
  providerResolver: fakeProviderResolver,
  catalogFetcher,
});

const e2eSecretStore = await SecretStore.open(dataDir);
createCredential(
  { db: running.db, secretStore: e2eSecretStore },
  { provider: "deepseek", label: "E2E Key", apiKey: "sk-e2e" },
);
await refreshModelCatalog(
  {
    db: running.db,
    secretStore: e2eSecretStore,
    fetcher: catalogFetcher,
  },
  { clientSessionId: "bs_e2e" },
);

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
