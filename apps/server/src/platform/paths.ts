import { constants } from "node:fs";
import { access, chmod, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import envPaths from "env-paths";

export const DATA_SUBDIRS = [
  "logs",
  "backups",
  "tmp",
  "sessions",
  "artifacts",
  "secrets",
  "ipc",
] as const;

export class DataDirError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataDirError";
  }
}

export function defaultDataDir(): string {
  return envPaths("larness", { suffix: "" }).data;
}

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.LARNESS_DATA_DIR?.trim();
  return override ? path.resolve(override) : defaultDataDir();
}

export interface EnsuredDataDir {
  created: boolean;
  hardened: boolean;
}

interface EnsureDirResult {
  created: boolean;
  hardened: boolean;
}

async function ensureDir(dir: string): Promise<EnsureDirResult> {
  try {
    const info = await stat(dir);

    if (!info.isDirectory()) {
      throw new DataDirError(`data directory path is not a directory: ${dir}`);
    }

    let hardened = false;

    if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
      try {
        await chmod(dir, 0o700);
        hardened = true;
      } catch (error) {
        throw new DataDirError(
          `cannot restrict permissions on ${dir}: ${(error as NodeJS.ErrnoException).code}`,
        );
      }
    }

    return { created: false, hardened };
  } catch (error) {
    if (error instanceof DataDirError) {
      throw error;
    }

    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new DataDirError(
        `cannot access data directory ${dir}: ${(error as NodeJS.ErrnoException).code}`,
      );
    }

    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    } catch (mkdirError) {
      throw new DataDirError(
        `cannot create data directory ${dir}: ${(mkdirError as NodeJS.ErrnoException).code}`,
      );
    }

    return { created: true, hardened: false };
  }
}

export async function ensureDataDirs(dataDir: string): Promise<EnsuredDataDir> {
  const root = await ensureDir(dataDir);
  let hardened = root.hardened;

  for (const name of DATA_SUBDIRS) {
    const result = await ensureDir(path.join(dataDir, name));
    hardened = hardened || result.hardened;
  }

  try {
    await access(dataDir, constants.W_OK);
  } catch {
    throw new DataDirError(`data directory is not writable: ${dataDir}`);
  }

  return { created: root.created, hardened };
}
