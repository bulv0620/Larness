import { CommandParamsSchema, ShellCommandParamsSchema } from "@larness/shared";

const SAFE_SCRIPTS = /^(test|check|typecheck|lint|build|verify)(:.*)?$/;
const DANGEROUS_PNPM = new Set([
  "exec",
  "dlx",
  "add",
  "install",
  "remove",
  "uninstall",
  "publish",
  "deploy",
  "link",
  "patch",
  "update",
  "create",
  "init",
  "config",
  "set",
]);
const UNSAFE_PNPM_FLAGS = ["--prefix", "--dir", "--cwd", "-C", "--global", "-g"];
const SAFE_GIT = new Set(["status", "diff", "log", "show", "rev-parse", "ls-files"]);
const SAFE_GIT_BRANCH_FLAGS = new Set(["-a", "-v", "-r", "--list", "--show-current"]);
const UNSAFE_GIT_FLAGS = ["--output", "-o", "--no-index", "--ext-diff", "--textconv"];
const SAFE_RG_FLAGS = new Set(["--pre", "--pre-glob"]);

/** A program name without a path; absolute or relative paths are not allowlisted. */
function executableName(executable: string): string {
  if (executable.includes("/") || executable.includes("\\")) {
    return "";
  }

  return executable.toLowerCase().replace(/\.exe$/, "");
}

function unsafePath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("~") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.split(/[\\/]/).includes("..")
  );
}

function hasUnsafeFlag(value: string, flags: readonly string[]): boolean {
  return flags.some((flag) => value === flag || value.startsWith(`${flag}=`));
}

/**
 * Conservative allowlist for approval classification only. It is not a
 * sandbox: commands still run with the Larness account's authority.
 */
export function isAllowlistedCommand(input: unknown): boolean {
  const parsed = CommandParamsSchema.safeParse(input);

  if (!parsed.success) {
    return false;
  }

  const { executable, args } = parsed.data;
  const name = executableName(executable);

  if (name === "git") {
    const [subcommand, ...rest] = args;

    if (subcommand === "branch") {
      return rest.every((arg) => SAFE_GIT_BRANCH_FLAGS.has(arg));
    }

    if (subcommand === undefined || !SAFE_GIT.has(subcommand)) {
      return false;
    }

    return !args.some((arg) => hasUnsafeFlag(arg, UNSAFE_GIT_FLAGS));
  }

  if (name === "pnpm" || name === "npm" || name === "yarn") {
    if (args.some((arg) => DANGEROUS_PNPM.has(arg))) {
      return false;
    }

    if (args.some((arg) => hasUnsafeFlag(arg, UNSAFE_PNPM_FLAGS))) {
      return false;
    }

    return args.some((arg) => SAFE_SCRIPTS.test(arg));
  }

  if (name === "rg") {
    if (args.some((arg) => hasUnsafeFlag(arg, [...SAFE_RG_FLAGS]))) {
      return false;
    }

    return !args.some(unsafePath);
  }

  if (name === "ls") {
    return !args.some(unsafePath);
  }

  if (name === "pwd") {
    return args.length === 0;
  }

  if (name === "node") {
    return args.length === 1 && (args[0] === "--version" || args[0] === "-v");
  }

  return false;
}

/**
 * Shell strings are allowlisted only when they are a simple command: no
 * pipes/redirects/command substitution/quotes and no absolute or parent paths.
 */
export function isAllowlistedShellCommand(input: unknown): boolean {
  const parsed = ShellCommandParamsSchema.safeParse(input);

  if (!parsed.success) {
    return false;
  }

  const command = parsed.data.command.trim();

  if (command.length === 0) {
    return false;
  }

  if (/[;&|<>$`\n\r]/.test(command) || command.includes("'") || command.includes('"')) {
    return false;
  }

  const [executable, ...args] = command.split(/\s+/);

  return isAllowlistedCommand({
    executable: executable ?? "",
    args,
    cwd: parsed.data.cwd,
  });
}
