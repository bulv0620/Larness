import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/bootstrap/config.js";
import { testConfig, withTempDir, writeConfig } from "./helpers.js";

describe("loadConfig", () => {
  it("uses defaults when config.json is absent", async () => {
    await withTempDir(async (dir) => {
      const loaded = await loadConfig({ dataDir: dir, env: {} });

      expect(loaded.source).toBe("defaults");
      expect(loaded.config.server.host).toBe("127.0.0.1");
      expect(loaded.config.server.port).toBe(3210);
      expect(loaded.config.preview).toEqual({ enabled: true, port: 3211 });
      expect(loaded.webAuthn).toMatchObject({
        enabled: true,
        origin: "http://localhost:3210",
        rpId: "localhost",
        rpName: "Larness",
        reason: null,
      });
      expect(loaded.config.webauthn.origin).toBe("http://localhost:3210");
    });
  });

  it("enables preview when a config file omits preview settings", async () => {
    await withTempDir(async (dir) => {
      const { preview: _preview, ...config } = testConfig();
      await writeConfig(dir, config);

      const loaded = await loadConfig({ dataDir: dir, env: {} });
      expect(loaded.config.preview).toEqual({ enabled: true, port: 3211 });
    });
  });

  it("loads config.json and derives the canonical origin from publicUrl", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(
        dir,
        testConfig({
          server: { publicUrl: "https://larness.example.com", port: 4000 },
          logging: { level: "debug", retentionDays: 30 },
        }),
      );

      const loaded = await loadConfig({ dataDir: dir, env: {} });

      expect(loaded.source).toBe("file");
      expect(loaded.config.server.port).toBe(4000);
      expect(loaded.config.logging.retentionDays).toBe(30);
      expect(loaded.webAuthn).toMatchObject({
        enabled: true,
        origin: "https://larness.example.com",
        rpId: "larness.example.com",
      });
    });
  });

  it("lets environment variables override the file", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir);

      const loaded = await loadConfig({
        dataDir: dir,
        env: {
          LARNESS_HOST: "0.0.0.0",
          LARNESS_PORT: "4321",
          LARNESS_PUBLIC_URL: "http://localhost:5173",
          LARNESS_LOG_LEVEL: "warn",
        },
      });

      expect(loaded.config.server.host).toBe("0.0.0.0");
      expect(loaded.config.server.port).toBe(4321);
      expect(loaded.config.logging.level).toBe("warn");
      expect(loaded.webAuthn.origin).toBe("http://localhost:5173");
      expect(loaded.webAuthn.enabled).toBe(true);
    });
  });

  it("treats an empty LARNESS_PUBLIC_URL as null", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, testConfig({ server: { publicUrl: "https://larness.example.com" } }));

      const loaded = await loadConfig({
        dataDir: dir,
        env: { LARNESS_PUBLIC_URL: "" },
      });

      expect(loaded.config.server.publicUrl).toBeNull();
      expect(loaded.webAuthn.origin).toBe("http://localhost:3210");
    });
  });

  it("rejects invalid JSON", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir);
      await writeFile(path.join(dir, "config.json"), "{ not json", { mode: 0o600 });

      await expect(loadConfig({ dataDir: dir, env: {} })).rejects.toBeInstanceOf(ConfigError);
      await expect(loadConfig({ dataDir: dir, env: {} })).rejects.toThrow(/valid JSON/);
    });
  });

  it("rejects schema violations including unknown keys", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, { ...testConfig(), extra: true });

      await expect(loadConfig({ dataDir: dir, env: {} })).rejects.toThrow(/extra/);
    });
  });

  it("rejects an out-of-range port inside config.json", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, testConfig({ server: { port: 70000 } }));

      await expect(loadConfig({ dataDir: dir, env: {} })).rejects.toThrow(/server\.port/);
    });
  });

  it("rejects an invalid LARNESS_PORT", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir);

      await expect(loadConfig({ dataDir: dir, env: { LARNESS_PORT: "abc" } })).rejects.toThrow(
        /LARNESS_PORT/,
      );
    });
  });

  it("rejects a publicUrl that is not an origin", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, testConfig({ server: { publicUrl: "https://example.com/app" } }));

      await expect(loadConfig({ dataDir: dir, env: {} })).rejects.toThrow(/publicUrl/);
    });
  });

  it("disables passkeys for a remote http canonical origin", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, testConfig({ server: { publicUrl: "http://example.com:3210" } }));

      const loaded = await loadConfig({ dataDir: dir, env: {} });

      expect(loaded.webAuthn.enabled).toBe(false);
      expect(loaded.webAuthn.reason).toBe("remote_http");
      expect(loaded.webAuthn.rpId).toBe("example.com");
    });
  });

  it("disables passkeys when the RP ID is an IP address", async () => {
    await withTempDir(async (dir) => {
      await writeConfig(dir, testConfig({ server: { publicUrl: "https://127.0.0.1:3210" } }));

      const loaded = await loadConfig({ dataDir: dir, env: {} });

      expect(loaded.webAuthn.enabled).toBe(false);
      expect(loaded.webAuthn.reason).toBe("rp_id_is_ip");
    });
  });
});
