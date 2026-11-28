import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = process.env.LARNESS_DATA_DIR;
const port = Number(process.env.LARNESS_PORT);

if (!dataDir || !Number.isInteger(port)) {
  console.error("fixture requires LARNESS_DATA_DIR and LARNESS_PORT");
  process.exit(1);
}

const lockPath = path.join(dataDir, "larness.lock");
const tokenPath = path.join(dataDir, "ipc", "token");

await mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
await writeFile(tokenPath, "fixture-token\n", { mode: 0o600 });
await writeFile(
  lockPath,
  `${JSON.stringify({
    pid: process.pid,
    startedAt: Date.now(),
    version: "fixture",
    mode: "background",
  })}\n`,
  { mode: 0o600 },
);

const server = createServer((request, response) => {
  if (request.url === "/api/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }

  response.writeHead(404);
  response.end();
});

server.listen(port, "127.0.0.1");

const stop = async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(lockPath, { force: true });
  await rm(tokenPath, { force: true });
  process.exit(0);
};

process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
console.log("fixture ready");
