import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../apps/server/src/bootstrap/start.js";
import { connectIpc } from "../apps/server/src/ipc/client.js";

const dataDir = mkdtempSync(path.join(tmpdir(), "larness-e2e-"));
const port = 3210;
const publicUrl = "http://localhost:5173";
const password = "e2e admin password 123";

const root = fileURLToPath(new URL("..", import.meta.url));
const resultsDir = path.join(root, "test-results");
mkdirSync(resultsDir, { recursive: true });
writeFileSync(path.join(resultsDir, "e2e-data-dir"), dataDir);

const running = await startServer({
  env: {
    LARNESS_DATA_DIR: dataDir,
    LARNESS_PORT: String(port),
    LARNESS_PUBLIC_URL: publicUrl,
    LARNESS_LOG_LEVEL: "warn",
  },
  logDestination: process.stderr,
});

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
