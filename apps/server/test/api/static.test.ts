import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { deriveWebAuthn } from "@larness/shared";
import { afterEach, describe, expect, it } from "vitest";
import { APP_CSP } from "../../src/api/static.js";
import { createApp } from "../../src/app.js";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createAuthSettings } from "../../src/db/repositories/auth-settings.js";
import { testConfig, withTempDir } from "../helpers.js";

const apps: Array<ReturnType<typeof createApp>> = [];

afterEach(async () => {
  for (const app of apps.splice(0)) {
    await app.close();
  }
});

async function createStaticApp(dir: string) {
  const webDir = path.join(dir, "web");
  await mkdir(path.join(webDir, "assets"), { recursive: true });
  await writeFile(
    path.join(webDir, "index.html"),
    '<!doctype html><html><body><div id="root">Larness app</div></body></html>',
  );
  await writeFile(path.join(webDir, "assets", "app-123.js"), "console.log('asset');");
  await writeFile(path.join(webDir, "favicon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"/>');

  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  createAuthSettings(opened.db, { adminHash: "hash", initializedAt: 1, now: 1 });

  const config = testConfig({ server: { host: "127.0.0.1", port: 3210 } });
  const webAuthn = deriveWebAuthn({ port: 3210, publicUrl: null }, "Larness");
  const app = createApp({
    services: {
      db: opened.db,
      config,
      webAuthn,
      csrfKey: randomBytes(32),
    },
    webDistDir: webDir,
  });
  apps.push(app);

  return { app, opened };
}

describe("static hosting", () => {
  it("serves the SPA shell, hashed assets and security headers", async () => {
    await withTempDir(async (dir) => {
      const { app, opened } = await createStaticApp(dir);

      try {
        const index = await app.inject({ method: "GET", url: "/" });
        expect(index.statusCode).toBe(200);
        expect(index.headers["content-type"]).toContain("text/html");
        expect(index.body).toContain("Larness app");
        expect(index.headers["cache-control"]).toBe("no-store");
        expect(index.headers["content-security-policy"]).toBe(APP_CSP);
        expect(index.headers["x-frame-options"]).toBe("DENY");
        expect(index.headers["x-content-type-options"]).toBe("nosniff");

        const asset = await app.inject({ method: "GET", url: "/assets/app-123.js" });
        expect(asset.statusCode).toBe(200);
        expect(asset.headers["content-type"]).toContain("javascript");
        expect(asset.headers["cache-control"]).toContain("immutable");
        expect(asset.body).toContain("console.log");

        const favicon = await app.inject({ method: "GET", url: "/favicon.svg" });
        expect(favicon.statusCode).toBe(200);
        expect(favicon.headers["content-type"]).toContain("svg");

        const deepLink = await app.inject({ method: "GET", url: "/sessions/ses_1" });
        expect(deepLink.statusCode).toBe(200);
        expect(deepLink.body).toContain("Larness app");

        const missing = await app.inject({ method: "GET", url: "/assets/missing.js" });
        expect(missing.statusCode).toBe(404);
      } finally {
        opened.close();
      }
    });
  });

  it("keeps API routes JSON-only and never falls back to the SPA", async () => {
    await withTempDir(async (dir) => {
      const { app, opened } = await createStaticApp(dir);

      try {
        const health = await app.inject({ method: "GET", url: "/api/health" });
        expect(health.statusCode).toBe(200);
        expect(health.json()).toMatchObject({ status: "ok" });

        const apiUnknown = await app.inject({ method: "GET", url: "/api/projects" });
        expect(apiUnknown.statusCode).toBe(401);
        expect(apiUnknown.headers["content-type"]).toContain("application/json");
        expect(apiUnknown.body).not.toContain("Larness app");
      } finally {
        opened.close();
      }
    });
  });
});
