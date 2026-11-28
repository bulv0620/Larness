import { statSync } from "node:fs";
import { cp } from "node:fs/promises";
import path from "node:path";
import type { BenchmarkTask } from "./tasks.js";

const EXCLUDED_ROOTS = new Set([".git", ".larness", "tmp"]);

export interface ExternalTaskInput {
  repo: string;
  prompt: string;
  verify: string;
  id?: string;
  title?: string;
}

function nonEmpty(value: string, label: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`${label} is required`);
  }

  return trimmed;
}

/** Split a simple command string; quotes and shell operators are not supported. */
export function splitCommand(command: string): string[] {
  const parts = nonEmpty(command, "verify command").split(/\s+/);

  if (parts.length === 0) {
    throw new Error("verify command is required");
  }

  return parts;
}

function externalId(repo: string, requested: string | undefined): string {
  const base = requested?.trim() || path.basename(repo) || "external-repo";
  const sanitized = base
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return sanitized || "external-repo";
}

export function createExternalTask(input: ExternalTaskInput): BenchmarkTask {
  const repo = nonEmpty(input.repo, "repo");
  let isDirectory = false;

  try {
    isDirectory = statSync(repo).isDirectory();
  } catch {
    isDirectory = false;
  }

  if (!isDirectory) {
    throw new Error(`repo is not a directory: ${repo}`);
  }

  const prompt = nonEmpty(input.prompt, "prompt");
  const verify = splitCommand(input.verify);
  const resolvedRepo = path.resolve(repo);

  return {
    id: externalId(resolvedRepo, input.id),
    title: input.title?.trim() || `External repo: ${path.basename(resolvedRepo)}`,
    prompts: [prompt],
    files: [],
    verify,
    repo: resolvedRepo,
  };
}

export async function copyExternalRepo(source: string, target: string): Promise<void> {
  const root = path.resolve(source);

  await cp(root, target, {
    recursive: true,
    force: true,
    errorOnExist: false,
    filter: (entry) => {
      const relative = path.relative(root, entry);

      if (relative.length === 0) {
        return true;
      }

      const first = relative.split(path.sep)[0] ?? "";
      return !EXCLUDED_ROOTS.has(first);
    },
  });
}
