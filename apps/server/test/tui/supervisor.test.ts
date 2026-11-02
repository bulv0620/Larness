import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { setMeta } from "../../src/db/repositories/meta.js";
import { loadManagedConfig, managedCommands, resolveWebUrl } from "../../src/tui/supervisor.js";
import { testConfig, withTempDir, writeConfig } from "../helpers.js";

const serverRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = path.resolve(serverRoot, "../..");

describe("managed TUI commands", () => {
  it("uses direct tsx and Vite entries in development", () => {
    const commands = managedCommands({ dev: true, serverRoot, repoRoot, nodePath: "/node" });

    expect(commands.serverCommand).toBe("/node");
    expect(commands.serverArgs[0]).toBe("--import");
    expect(commands.serverArgs[1]).toContain("tsx");
    expect(commands.serverArgs[2]).toBe(path.join(serverRoot, "src", "index.ts"));
    expect(commands.webCommand).toBe("/node");
    expect(commands.webArgs[0]).toBe("--import");
    expect(commands.webArgs[2]).toBe(
      path.join(repoRoot, "apps", "web", "scripts", "managed-vite.ts"),
    );
    expect(commands.webCwd).toBe(path.join(repoRoot, "apps", "web"));
  });

  it("uses the built server and no Vite in production", () => {
    const commands = managedCommands({ dev: false, serverRoot, repoRoot, nodePath: "/node" });

    expect(commands.serverArgs).toEqual([path.join(serverRoot, "dist", "index.js")]);
    expect(commands.webCommand).toBeNull();
    expect(commands.webArgs).toEqual([]);
  });
});

describe("web origin resolution", () => {
  it.each([true, false])("uses the same configured public address in either mode (%s)", (dev) => {
    expect(
      resolveWebUrl({
        dev,
        serverPort: 3210,
        publicUrl: null,
        canonicalOrigin: "http://localhost:3210",
      }),
    ).toBe("http://localhost:3210");
    expect(
      resolveWebUrl({
        dev,
        serverPort: 5173,
        publicUrl: "http://localhost:5173",
        canonicalOrigin: "http://localhost:5173",
      }),
    ).toBe("http://localhost:5173");
    expect(() =>
      resolveWebUrl({
        dev,
        serverPort: 3210,
        publicUrl: "http://localhost:5173",
        canonicalOrigin: "http://localhost:5173",
      }),
    ).toThrow(/server.port.*5173/);
    expect(
      resolveWebUrl({
        dev,
        serverPort: 3210,
        publicUrl: "https://localhost:9443",
        canonicalOrigin: "https://localhost:9443",
      }),
    ).toBe("https://localhost:9443");
    expect(
      resolveWebUrl({
        dev,
        serverPort: 3210,
        publicUrl: "https://larness.example.com",
        canonicalOrigin: "https://larness.example.com",
      }),
    ).toBe("https://larness.example.com");
  });
});

describe("managed recovery planning", () => {
  it("uses committed pending settings without mutating the database or existing config", async () => {
    await withTempDir(async (dir) => {
      const file = await writeConfig(dir);
      const before = await readFile(file, "utf8");
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      setMeta(
        opened.db,
        "init_pending",
        JSON.stringify({
          version: 1,
          config: testConfig({ server: { port: 4321, publicUrl: "https://saved.example" } }),
        }),
      );
      opened.close();
      const loaded = await loadManagedConfig(dir, {});
      expect(loaded.config.server.port).toBe(4321);
      expect(loaded.webAuthn.origin).toBe("https://saved.example");
      expect(await readFile(file, "utf8")).toBe(before);
      const overridden = await loadManagedConfig(dir, { LARNESS_PORT: "5000" });
      expect(overridden.config.server.port).toBe(5000);
    });
  });

  it("fails closed on invalid recovery metadata instead of falling back to old config", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir);
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      setMeta(opened.db, "init_pending", "invalid");
      opened.close();
      await expect(loadManagedConfig(dir, {})).rejects.toThrow(/initialization recovery/);
    });
  });
});

it("keeps the actionable legacy configuration diagnostic visible through the TUI error formatter", async () => {
  const { displayError } = await import("../../src/tui/page-error.js");
  let message = "";
  try {
    resolveWebUrl({
      dev: true,
      serverPort: 3210,
      publicUrl: "http://localhost:5173",
      canonicalOrigin: "http://localhost:5173",
    });
  } catch (error) {
    message = displayError(error);
  }
  expect(message).toContain("server.port 对齐为 5173");
  expect(message).not.toContain("无法读取或校验数据");
});
