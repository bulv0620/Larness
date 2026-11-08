import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import semver from "semver";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

export type UpdateChannel = "stable" | "beta";

export interface UpdateNotice {
  currentVersion: string;
  latestVersion: string;
  channel: UpdateChannel;
  command: string;
  checkedAt: number;
}

interface UpdateState {
  lastAttemptAt?: number;
  lastCheckedAt?: number;
  lastNotifiedVersion?: string;
  channel?: UpdateChannel;
}

export interface CheckForUpdateOptions {
  version: string;
  dataDir: string;
  channel?: UpdateChannel;
  now?: () => number;
  fetchImpl?: typeof fetch;
  registryUrl?: string;
}

function statePath(dataDir: string): string {
  return path.join(dataDir, "updates", "state.json");
}

async function readState(file: string): Promise<UpdateState> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as UpdateState;
  } catch {
    return {};
  }
}

async function writeState(file: string, state: UpdateState): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify(state), { mode: 0o600 });
    await chmod(file, 0o600);
  } catch {
    // Update check must never block startup or usage.
  }
}

function isChannel(value: unknown): value is UpdateChannel {
  return value === "stable" || value === "beta";
}

function commandFor(channel: UpdateChannel): string {
  return channel === "beta" ? "npm install -g larness@beta" : "npm install -g larness@latest";
}

export async function checkForUpdate(options: CheckForUpdateOptions): Promise<UpdateNotice | null> {
  if (options.version === "0.0.0" || process.env.LARNESS_DEV === "1") {
    return null;
  }
  if (!semver.valid(options.version)) {
    return null;
  }

  const now = options.now ?? Date.now;
  const channel = options.channel ?? "stable";
  const file = statePath(options.dataDir);
  const state = await readState(file);
  const timestamp = now();

  if (
    typeof state.lastAttemptAt === "number" &&
    timestamp - state.lastAttemptAt < CHECK_INTERVAL_MS
  ) {
    return null;
  }

  const registry = (options.registryUrl ?? DEFAULT_REGISTRY).replace(/\/$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  let latestVersion: string;
  try {
    const response = await fetchImpl(`${registry}/-/package/larness/dist-tags`, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      await writeState(file, { ...state, lastAttemptAt: timestamp, channel });
      return null;
    }
    const body = (await response.json()) as Record<string, unknown>;
    const candidate = body[channel === "beta" ? "beta" : "latest"];
    if (typeof candidate !== "string" || !semver.valid(candidate)) {
      await writeState(file, { ...state, lastAttemptAt: timestamp, channel });
      return null;
    }
    latestVersion = candidate;
  } catch {
    await writeState(file, { ...state, lastAttemptAt: timestamp, channel });
    return null;
  }

  const nextState: UpdateState = {
    lastAttemptAt: timestamp,
    lastCheckedAt: timestamp,
    channel,
  };

  if (!semver.gt(latestVersion, options.version)) {
    await writeState(file, nextState);
    return null;
  }

  if (state.lastNotifiedVersion === latestVersion && state.channel === channel) {
    await writeState(file, nextState);
    return null;
  }

  await writeState(file, { ...nextState, lastNotifiedVersion: latestVersion });
  return {
    currentVersion: options.version,
    latestVersion,
    channel,
    command: commandFor(channel),
    checkedAt: timestamp,
  };
}

export function updateNoticeText(notice: UpdateNotice): string {
  return `有新版本 ${notice.latestVersion}（当前 ${notice.currentVersion}）· 运行 ${notice.command}`;
}

export function updateChannel(value: string | undefined): UpdateChannel {
  return isChannel(value) ? value : "stable";
}
