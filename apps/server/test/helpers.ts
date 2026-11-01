import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import {
  type AppConfig,
  type AuthConfig,
  DEFAULT_APP_CONFIG,
  type LoggingConfig,
  type PreviewConfig,
  type ServerConfig,
  type UpdatesConfig,
  type WebAuthnConfig,
} from "@larness/shared";

export async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "larness-test-"));
}

export async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await makeTempDir();
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function writeConfig(
  dataDir: string,
  config: unknown = DEFAULT_APP_CONFIG,
  mode = 0o600,
): Promise<string> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, "config.json");
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode });
  return file;
}

export interface TestConfigOverrides {
  version?: 1;
  server?: Partial<ServerConfig>;
  auth?: Partial<AuthConfig>;
  webauthn?: Partial<WebAuthnConfig>;
  logging?: Partial<LoggingConfig>;
  updates?: Partial<UpdatesConfig>;
  preview?: Partial<PreviewConfig>;
}

export function testConfig(overrides: TestConfigOverrides = {}): AppConfig {
  const base = structuredClone(DEFAULT_APP_CONFIG);
  return {
    version: overrides.version ?? base.version,
    server: { ...base.server, ...overrides.server },
    auth: { ...base.auth, ...overrides.auth },
    webauthn: { ...base.webauthn, ...overrides.webauthn },
    logging: { ...base.logging, ...overrides.logging },
    updates: { ...base.updates, ...overrides.updates },
    preview: { ...base.preview, ...overrides.preview },
  };
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

export interface LogSink {
  stream: Writable;
  text(): string;
  lines(): string[];
}

export function createLogSink(): LogSink {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });

  return {
    stream,
    text: () => chunks.join(""),
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((line) => line.length > 0),
  };
}
