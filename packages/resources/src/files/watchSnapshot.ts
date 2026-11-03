import { watch } from "node:fs";
import { lstat, opendir, stat } from "node:fs/promises";
import path from "node:path";
import { FileManagerError, readEditableFile, resolveFilePath } from "./fileManager.js";
import { isIgnoredFile } from "./fileService.js";

export interface WatchedNode {
  type: "file" | "directory";
  size: number;
  mtime: number;
  inode: number;
  device: number;
  version?: string;
}
export interface WatchSnapshot {
  nodes: Map<string, WatchedNode>;
  identity: string;
  partial: boolean;
}
export async function scanWatchPath(
  root: string,
  relative: string,
  options: {
    directory: boolean;
    limit: number;
    ignore: string[];
    exclude?: (absolute: string) => boolean;
  },
): Promise<WatchSnapshot> {
  let target: string;
  try {
    target = await resolveFilePath(root, relative);
  } catch (error) {
    if (error instanceof FileManagerError && error.code === "NOT_FOUND")
      return { nodes: new Map(), identity: "missing", partial: false };
    throw error;
  }
  const before = await lstat(target);
  const nodes = new Map<string, WatchedNode>();
  let partial = false;
  if (options.directory && before.isDirectory()) {
    const directory = await opendir(target);
    let scanned = 0;
    for await (const entry of directory) {
      if (++scanned > options.limit) {
        partial = true;
        break;
      }
      if (!entry.isDirectory() && !entry.isFile()) continue;
      const child = path.posix.join(relative, entry.name);
      if (
        isIgnoredFile(child, entry.name, options.ignore) ||
        entry.name.startsWith(".larness-save-")
      )
        continue;
      if (options.exclude?.(path.join(target, entry.name))) continue;
      const real = await resolveFilePath(root, child);
      const info = await lstat(real);
      if (!info.isFile() && !info.isDirectory()) continue;
      nodes.set(child, {
        type: info.isDirectory() ? "directory" : "file",
        size: info.size,
        mtime: info.mtimeMs,
        inode: info.ino,
        device: info.dev,
      });
    }
  } else if (!options.directory && before.isFile()) {
    let version: string | undefined;
    try {
      version = (await readEditableFile(root, relative)).version;
    } catch (error) {
      if (
        !(error instanceof FileManagerError) ||
        !["FILE_NOT_EDITABLE", "PAYLOAD_TOO_LARGE"].includes(error.code)
      )
        throw error;
    }
    nodes.set(relative, {
      type: "file",
      size: before.size,
      mtime: before.mtimeMs,
      inode: before.ino,
      device: before.dev,
      version,
    });
  } else throw new FileManagerError("CONFLICT", "Watched path type changed");
  const after = await stat(await resolveFilePath(root, relative));
  if (before.ino !== after.ino || before.dev !== after.dev || before.mtimeMs !== after.mtimeMs)
    throw new FileManagerError("CONFLICT", "Watched path changed during scan");
  return { nodes, identity: `${before.dev}:${before.ino}`, partial };
}
export const createDirectoryWatcher = (
  directory: string,
  changed: () => void,
  failed: () => void,
) => {
  const watcher = watch(directory, changed);
  watcher.on("error", failed);
  return watcher;
};
