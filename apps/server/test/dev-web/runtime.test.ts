import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { connectIpc } from "../../src/ipc/client.js";
import { startManagedRuntime } from "../../src/tui/supervisor.js";
import { getFreePort, testConfig, withTempDir, writeConfig } from "../helpers.js";

it("starts the real managed dev at its configured address, initializes without rewriting the origin and releases children", async () => {
  await withTempDir(async (dir) => {
    const port = await getFreePort();
    await writeConfig(dir, testConfig({ server: { port } }));
    const env = { ...process.env };
    for (const key of Object.keys(process.env))
      if (key.startsWith("LARNESS_")) delete process.env[key];
    process.env.LARNESS_DATA_DIR = dir;
    let runtime: Awaited<ReturnType<typeof startManagedRuntime>> | undefined;
    try {
      runtime = await startManagedRuntime({ dev: true, out: () => undefined });
      expect(runtime.webUrl).toBe(`http://localhost:${port}`);
      const page = await fetch(runtime.webUrl);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toContain("nonce-");
      const client = await connectIpc({ dataDir: dir, client: "test" });
      try {
        await client.request("init.apply", {});
        expect(await client.request("init.status")).toMatchObject({ initialized: true });
      } finally {
        client.close();
      }
      const config = JSON.parse(await readFile(path.join(dir, "config.json"), "utf8"));
      expect(config.server.publicUrl).toBeNull();
      expect(config.server.port).toBe(port);
    } finally {
      await runtime?.stop();
      for (const key of Object.keys(process.env))
        if (key.startsWith("LARNESS_")) delete process.env[key];
      Object.assign(process.env, env);
    }
    expect(existsSync(path.join(dir, "larness.lock"))).toBe(false);
    expect(existsSync(path.join(dir, "ipc/token"))).toBe(false);
  });
}, 45000);

it("keeps an environment port out of first-init persisted defaults and aborts startup cleanly", async () => {
  await withTempDir(async (dir) => {
    const env = { ...process.env };
    for (const key of Object.keys(process.env))
      if (key.startsWith("LARNESS_")) delete process.env[key];
    const port = await getFreePort();
    process.env.LARNESS_DATA_DIR = dir;
    process.env.LARNESS_PORT = String(port);
    let runtime: Awaited<ReturnType<typeof startManagedRuntime>> | undefined;
    try {
      runtime = await startManagedRuntime({ dev: true, out: () => undefined });
      const client = await connectIpc({ dataDir: dir, client: "test" });
      try {
        await client.request("init.apply", {});
      } finally {
        client.close();
      }
      const config = JSON.parse(await readFile(path.join(dir, "config.json"), "utf8"));
      expect(config.server.port).toBe(3210);
      expect(config.server.publicUrl).toBeNull();
      await runtime.stop();
      runtime = undefined;
      const abort = new AbortController();
      const pending = startManagedRuntime({
        dev: true,
        out: () => undefined,
        signal: abort.signal,
      });
      abort.abort();
      await expect(pending).rejects.toThrow();
    } finally {
      await runtime?.stop();
      for (const key of Object.keys(process.env))
        if (key.startsWith("LARNESS_")) delete process.env[key];
      Object.assign(process.env, env);
    }
    expect(existsSync(path.join(dir, "larness.lock"))).toBe(false);
  });
}, 45000);
