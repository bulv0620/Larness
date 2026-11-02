// Run after pnpm build: exercises built child processes with disposable data.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_APP_CONFIG } from "@larness/shared";
import { z } from "zod";
import { openDatabase } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { createAuthSettings, getAuthSettings } from "../src/db/repositories/auth-settings.js";
import { setMeta } from "../src/db/repositories/meta.js";
import { connectIpc } from "../src/ipc/client.js";
import { runManagedSessions } from "../src/tui/lifecycle.js";
import { startManagedRuntime } from "../src/tui/supervisor.js";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("no TCP address"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

const root = await mkdtemp(path.join(tmpdir(), "larness-init-smoke-"));
for (const name of ["LARNESS_HOST", "LARNESS_PORT", "LARNESS_PUBLIC_URL", "LARNESS_LOG_LEVEL"])
  delete process.env[name];
try {
  const originalPort = await freePort();
  let nextPort = await freePort();
  while (nextPort === originalPort) nextPort = await freePort();
  const initial = structuredClone(DEFAULT_APP_CONFIG);
  initial.server.port = originalPort;
  await writeFile(path.join(root, "config.json"), JSON.stringify(initial), { mode: 0o600 });
  process.env.LARNESS_DATA_DIR = root;
  let attachments = 0;
  await runManagedSessions({
    start: () => startManagedRuntime({ dev: false }),
    onRuntime: () => undefined,
    attach: async (runtime) => {
      const client = await connectIpc({ dataDir: root, client: "init-smoke" });
      try {
        attachments += 1;
        if (attachments === 1) {
          const result = z
            .object({ restartRequired: z.boolean(), origin: z.string() })
            .parse(await client.request("init.apply", { port: nextPort }));
          assert.equal(result.restartRequired, true);
          assert.equal(result.origin, `http://localhost:${nextPort}`);
          return "restart";
        }
        assert.equal(runtime.config.config.server.port, nextPort);
        const status = z
          .object({ initialized: z.boolean(), listen: z.object({ port: z.number() }) })
          .parse(await client.request("system.status"));
        assert.equal(status.initialized, true);
        assert.equal(status.listen.port, nextPort);
        return "done";
      } finally {
        client.close();
      }
    },
  });
  assert.equal(attachments, 2);
  const opened = openDatabase(path.join(root, "larness.db"));
  try {
    assert.equal(getAuthSettings(opened.db)?.adminHash, "");
  } finally {
    opened.close();
  }
  console.log(
    "PASS: built runtime applies password-free initialization and reconnects on the new port",
  );

  const recoveryDir = path.join(root, "recovery");
  await mkdir(recoveryDir, { mode: 0o700 });
  const recovery = openDatabase(path.join(recoveryDir, "larness.db"));
  runMigrations(recovery.db);
  const committed = structuredClone(DEFAULT_APP_CONFIG);
  committed.server.port = await freePort();
  createAuthSettings(recovery.db, { adminHash: "historical-hash", initializedAt: 1, now: 1 });
  setMeta(recovery.db, "init_pending", JSON.stringify({ version: 1, config: committed }));
  recovery.close();
  await writeFile(path.join(recoveryDir, "config.json"), "interrupted file", { mode: 0o600 });
  process.env.LARNESS_DATA_DIR = recoveryDir;
  const runtime = await startManagedRuntime({ dev: false });
  try {
    assert.equal(runtime.config.config.server.port, committed.server.port);
  } finally {
    await runtime.stop();
  }
  const recovered = openDatabase(path.join(recoveryDir, "larness.db"));
  try {
    assert.equal(getAuthSettings(recovered.db)?.adminHash, "historical-hash");
  } finally {
    recovered.close();
  }
  console.log(
    "PASS: built runtime recovers committed settings before reading a broken config file; historical hash retained",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
