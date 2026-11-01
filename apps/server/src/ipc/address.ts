import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

export const UNIX_SOCKET_PATH_LIMIT = 100;

export interface IpcAddress {
  path: string;
  kind: "unix" | "pipe";
  tempDirectory: string | null;
}

function shortHash(dataDir: string): string {
  return createHash("sha256").update(dataDir).digest("hex").slice(0, 16);
}

export function resolveIpcAddress(
  dataDir: string,
  platform: NodeJS.Platform = process.platform,
  tempRoot: string = tmpdir(),
): IpcAddress {
  if (platform === "win32") {
    return {
      path: `\\\\.\\pipe\\larness-${shortHash(dataDir)}`,
      kind: "pipe",
      tempDirectory: null,
    };
  }

  const localPath = path.join(dataDir, "ipc", "larness.sock");

  if (Buffer.byteLength(localPath, "utf8") <= UNIX_SOCKET_PATH_LIMIT) {
    return { path: localPath, kind: "unix", tempDirectory: null };
  }

  const directory = path.join(tempRoot, `larness-${shortHash(dataDir)}`);

  return {
    path: path.join(directory, "larness.sock"),
    kind: "unix",
    tempDirectory: directory,
  };
}

export function ipcTokenPath(dataDir: string): string {
  return path.join(dataDir, "ipc", "token");
}
