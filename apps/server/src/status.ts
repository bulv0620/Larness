import path from "node:path";
import type { WebAuthnRuntime } from "@larness/shared";
import { loadConfig } from "./bootstrap/config.js";
import { inspectInstanceLock } from "./bootstrap/lock.js";
import { inspectDatabase } from "./db/inspect.js";
import { resolveDataDir } from "./platform/paths.js";
import { SERVER_VERSION } from "./version.js";

export interface StatusReport {
  version: string;
  initialized: boolean;
  running: boolean;
  pid: number | null;
  uptimeMs: number | null;
  listen: { host: string; port: number };
  db: { ok: boolean; schemaVersion: number; detail: string } | null;
  ipc: { ok: boolean; clients: number; detail: string } | null;
  sessions: { online: number; pendingPairings: number };
  publicUrl: string | null;
  webauthn: {
    enabled: boolean;
    rpId: string;
    origin: string;
    reason: WebAuthnRuntime["reason"];
  };
  warnings: string[];
}

export interface CollectStatusOptions {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

export async function collectStatus(options: CollectStatusOptions = {}): Promise<StatusReport> {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? resolveDataDir(env);
  const now = options.now ?? Date.now;
  const loaded = await loadConfig({ dataDir, env });
  const lock = await inspectInstanceLock(dataDir);
  const database = inspectDatabase(path.join(dataDir, "larness.db"));
  const running = lock?.alive === true;
  const record = lock?.record ?? null;
  const warnings: string[] = [];

  if (loaded.source === "defaults") {
    warnings.push("config.json is missing; the workspace is not initialized");
  }

  if (lock !== null && !running) {
    warnings.push(
      record
        ? `stale lock file from pid ${record.pid}; it will be replaced on the next start`
        : "lock file is unreadable; verify no server is running before removing it",
    );
  }

  if (!running) {
    warnings.push("server is not running");
  }

  if (database === null) {
    warnings.push("database is not initialized; start the server to run migrations");
  } else if (!database.ok) {
    warnings.push(`database check failed: ${database.detail}`);
  }

  warnings.push("local IPC is not available until M0-4");

  return {
    version: SERVER_VERSION,
    initialized: loaded.source === "file",
    running,
    pid: running ? (record?.pid ?? null) : null,
    uptimeMs: running && record ? Math.max(0, now() - record.startedAt) : null,
    listen: {
      host: loaded.config.server.host,
      port: loaded.config.server.port,
    },
    db: database,
    ipc: null,
    sessions: { online: 0, pendingPairings: 0 },
    publicUrl: loaded.config.server.publicUrl,
    webauthn: {
      enabled: loaded.webAuthn.enabled,
      rpId: loaded.webAuthn.rpId,
      origin: loaded.webAuthn.origin,
      reason: loaded.webAuthn.reason,
    },
    warnings,
  };
}
