import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { satisfies } from "semver";
import { type LoadedConfig, loadConfig } from "./bootstrap/config.js";
import { inspectInstanceLock } from "./bootstrap/lock.js";
import { inspectDatabase } from "./db/inspect.js";
import { expectedMigrationCount } from "./db/migrate.js";
import { DATA_SUBDIRS, resolveDataDir } from "./platform/paths.js";
import { SERVER_VERSION, SUPPORTED_NODE_RANGE } from "./version.js";

export type DoctorCheckStatus = "ok" | "warn" | "fail" | "skip";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  detail: string;
}

export interface DoctorReport {
  version: string;
  dataDir: string;
  checks: DoctorCheck[];
}

export interface RunDoctorOptions {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
}

function checkPort(host: string, port: number): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const server = createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      resolve({ ok: false, detail: `unavailable: ${error.code ?? error.message}` });
    });

    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => resolve({ ok: true, detail: `available on ${host}:${port}` }));
    });
  });
}

export async function runDoctor(options: RunDoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? resolveDataDir(env);
  const checks: DoctorCheck[] = [];
  const add = (id: string, label: string, status: DoctorCheckStatus, detail: string): void => {
    checks.push({ id, label, status, detail });
  };

  add(
    "node",
    `Node.js ${SUPPORTED_NODE_RANGE}`,
    satisfies(process.versions.node, SUPPORTED_NODE_RANGE) ? "ok" : "fail",
    process.versions.node,
  );

  let dataInfo: Awaited<ReturnType<typeof stat>> | null = null;

  try {
    dataInfo = await stat(dataDir);
  } catch {
    dataInfo = null;
  }

  if (dataInfo === null || !dataInfo.isDirectory()) {
    add("data-dir", "数据目录", "fail", `missing or not a directory: ${dataDir}`);
    add("data-dir-permissions", "数据目录权限", "skip", "data directory unavailable");
    add("data-dir-subdirs", "数据子目录", "skip", "data directory unavailable");
  } else {
    add("data-dir", "数据目录", "ok", dataDir);

    if (process.platform === "win32") {
      add(
        "data-dir-permissions",
        "数据目录权限",
        "skip",
        "POSIX permissions not enforced on Windows",
      );
    } else {
      const mode = dataInfo.mode & 0o777;
      add(
        "data-dir-permissions",
        "数据目录权限",
        mode & 0o077 ? "fail" : "ok",
        `mode ${mode.toString(8).padStart(4, "0")} (expected 0700)`,
      );
    }

    try {
      await access(dataDir, constants.W_OK);
    } catch {
      add("data-dir-writable", "数据目录可写", "fail", "directory is not writable");
    }

    const missing: string[] = [];

    for (const name of DATA_SUBDIRS) {
      try {
        const info = await stat(path.join(dataDir, name));
        if (!info.isDirectory()) {
          missing.push(name);
        }
      } catch {
        missing.push(name);
      }
    }

    add(
      "data-dir-subdirs",
      "数据子目录",
      missing.length === 0 ? "ok" : "warn",
      missing.length === 0 ? DATA_SUBDIRS.join(", ") : `missing: ${missing.join(", ")}`,
    );
  }

  let loaded: LoadedConfig | null = null;

  try {
    loaded = await loadConfig({ dataDir, env });
    add(
      "config",
      "config.json",
      "ok",
      loaded.source === "file" ? loaded.path : "not initialized; defaults in use",
    );
  } catch (error) {
    add("config", "config.json", "fail", error instanceof Error ? error.message : String(error));
  }

  if (loaded?.source === "file" && process.platform !== "win32") {
    try {
      const info = await stat(loaded.path);
      const mode = info.mode & 0o777;
      add(
        "config-permissions",
        "配置文件权限",
        mode & 0o077 ? "fail" : "ok",
        `mode ${mode.toString(8).padStart(4, "0")} (expected 0600)`,
      );
    } catch {
      add("config-permissions", "配置文件权限", "warn", "cannot stat config.json");
    }
  }

  if (loaded === null) {
    add("https", "HTTPS / publicUrl", "skip", "config invalid");
    add("webauthn", "WebAuthn canonical origin", "skip", "config invalid");
    add("port", "监听端口", "skip", "config invalid");
  } else {
    const { publicUrl } = loaded.config.server;
    const httpsRequired = loaded.config.auth.requireHttpsForRemote;

    if (publicUrl === null) {
      add("https", "HTTPS / publicUrl", "warn", "no publicUrl; local-only http://localhost origin");
    } else {
      const url = new URL(publicUrl);
      const remoteHttp = url.protocol === "http:" && url.hostname !== "localhost";
      add(
        "https",
        "HTTPS / publicUrl",
        remoteHttp && httpsRequired ? "fail" : "ok",
        remoteHttp
          ? `${publicUrl} is plain http; remote access must use https`
          : `${publicUrl} (${url.protocol.slice(0, -1)})`,
      );
    }

    add(
      "webauthn",
      "WebAuthn canonical origin",
      loaded.webAuthn.enabled ? "ok" : "warn",
      loaded.webAuthn.enabled
        ? `origin ${loaded.webAuthn.origin}, rpId ${loaded.webAuthn.rpId}`
        : `passkeys disabled: ${loaded.webAuthn.reason}`,
    );

    const lock = await inspectInstanceLock(dataDir);

    if (lock?.alive) {
      add("port", "监听端口", "ok", `served by running instance (pid ${lock.record?.pid})`);
    } else {
      const availability = await checkPort(loaded.config.server.host, loaded.config.server.port);
      add("port", "监听端口", availability.ok ? "ok" : "fail", availability.detail);
    }
  }

  const database = inspectDatabase(path.join(dataDir, "larness.db"));

  if (database === null) {
    add("database", "SQLite", "warn", "not initialized; start the server to run migrations");
    add("migrations", "数据库迁移", "warn", "no database yet");
  } else {
    add(
      "database",
      "SQLite",
      database.ok ? "ok" : "fail",
      `${database.detail} (schema version ${database.schemaVersion})`,
    );

    const expected = expectedMigrationCount();
    const pending = Math.max(0, expected - database.schemaVersion);

    add(
      "migrations",
      "数据库迁移",
      pending === 0 ? "ok" : "fail",
      pending === 0
        ? `applied ${database.schemaVersion} of ${expected}`
        : `${pending} pending of ${expected}`,
    );
  }

  add("clock", "时钟偏移", "skip", "requires a trusted time reference (not implemented)");

  return { version: SERVER_VERSION, dataDir, checks };
}
