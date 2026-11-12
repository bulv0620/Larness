import { stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_IGNORED } from "@larness/resources";
import type { TurnFileResult } from "@larness/shared";

/** Upper bound for one Turn's reported file results (spec 074 R-9). */
export const MAX_TURN_FILE_RESULTS = 200;

/** Directories whose contents are produced or discarded while working. */
const GENERATED_SEGMENTS = new Set([
  "tmp",
  ".tmp",
  "temp",
  "dist",
  "build",
  "coverage",
  ".cache",
  "test-results",
  "playwright-report",
]);

const GENERATED_SUFFIXES = [".tmp", ".bak", ".log", ".swp", ".orig"];

export interface TurnFileChange {
  path: string;
  changeType: "created" | "modified";
  version: string;
}

export interface CollectTurnFileOptions {
  root: string;
  changes: Iterable<TurnFileChange>;
  projectIgnore?: string[];
  limit?: number;
  /** Called for stat failures that are not "file is gone"; never receives content. */
  onError?: (filePath: string, error: unknown) => void;
}

function fileName(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}

/**
 * A path is process material when the project ignores it or it lives in a
 * generated / temporary location. This only affects result presentation; the
 * file stays visible in the file tree.
 */
function matchesPattern(filePath: string, raw: string): boolean {
  const pattern = raw
    .trim()
    .replace(/^\.?\/+/, "")
    .replace(/\/+$/, "");

  if (pattern.length === 0) {
    return false;
  }

  if (pattern.includes("/")) {
    return filePath === pattern || filePath.startsWith(`${pattern}/`);
  }

  return filePath.split("/").includes(pattern);
}

export function isProcessFile(filePath: string, projectIgnore: string[] = []): boolean {
  const name = fileName(filePath);
  const segments = filePath.split("/");

  if (segments.some((segment) => DEFAULT_IGNORED.has(segment))) {
    return true;
  }

  if (projectIgnore.some((pattern) => matchesPattern(filePath, pattern))) {
    return true;
  }

  if (segments.some((segment) => GENERATED_SEGMENTS.has(segment))) {
    return true;
  }

  return GENERATED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

export function classifyTurnFile(
  filePath: string,
  options: { existed: boolean; projectIgnore?: string[] },
): TurnFileResult["category"] {
  if (!options.existed) {
    return "process";
  }

  return isProcessFile(filePath, options.projectIgnore ?? []) ? "process" : "deliverable";
}

/**
 * Resolves each touched file once at Turn end. Deleted files stay listed as
 * process material so the user can see what was cleaned up. The check is
 * best-effort: a file that cannot be read is kept as a deliverable.
 */
export async function collectTurnFileResults(
  options: CollectTurnFileOptions,
): Promise<TurnFileResult[]> {
  const limit = options.limit ?? MAX_TURN_FILE_RESULTS;
  const results: TurnFileResult[] = [];

  for (const change of options.changes) {
    if (results.length >= limit) {
      break;
    }

    let existed = true;

    try {
      await stat(path.join(options.root, ...change.path.split("/")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        existed = false;
      } else {
        options.onError?.(change.path, error);
      }
    }

    results.push({
      ...change,
      existed,
      category: classifyTurnFile(change.path, {
        existed,
        projectIgnore: options.projectIgnore,
      }),
    });
  }

  return results;
}
