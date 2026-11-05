import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { FileManagerError } from "@larness/resources";

const PARTS = ["sessions", "global-terminal", "workspace"];
export function defaultWorkspacePath(dataDir: string): string {
  return path.join(dataDir, ...PARTS);
}
export function isDefaultWorkspace(dataDir: string, workspacePath: string): boolean {
  return path.resolve(workspacePath) === path.resolve(defaultWorkspacePath(dataDir));
}
export async function ensureDefaultWorkspace(dataDir: string): Promise<string> {
  const canonical = await realpath(dataDir);
  let directory = canonical;
  for (const part of PARTS) {
    directory = path.join(directory, part);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST")
        throw new FileManagerError("RESOURCE_UNAVAILABLE", "Default workspace unavailable");
    }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== directory)
      throw new FileManagerError("PATH_OUTSIDE_PROJECT", "Default workspace root changed");
  }
  return defaultWorkspacePath(dataDir);
}
