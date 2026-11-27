import { describe, expect, it } from "vitest";
import {
  isAllowlistedCommand,
  isAllowlistedShellCommand,
} from "../../src/modules/agent/commandAllowlist.js";

describe("command allowlist", () => {
  it("allows common read-only and verification commands", () => {
    expect(isAllowlistedCommand({ executable: "pnpm", args: ["check"] })).toBe(true);
    expect(
      isAllowlistedCommand({
        executable: "pnpm",
        args: ["--filter", "@larness/web", "test:file", "src/a.test.ts"],
      }),
    ).toBe(true);
    expect(isAllowlistedCommand({ executable: "pnpm", args: ["run", "test"] })).toBe(true);
    expect(isAllowlistedCommand({ executable: "npm", args: ["run", "build"] })).toBe(true);
    expect(isAllowlistedCommand({ executable: "yarn", args: ["lint"] })).toBe(true);
    expect(isAllowlistedCommand({ executable: "git", args: ["status"] })).toBe(true);
    expect(isAllowlistedCommand({ executable: "git", args: ["diff", "--stat"] })).toBe(true);
    expect(isAllowlistedCommand({ executable: "git", args: ["log", "--oneline"] })).toBe(true);
    expect(isAllowlistedCommand({ executable: "git", args: ["branch", "-a"] })).toBe(true);
    expect(isAllowlistedCommand({ executable: "rg", args: ["needle", "src"] })).toBe(true);
    expect(isAllowlistedCommand({ executable: "ls", args: ["-la"] })).toBe(true);
    expect(isAllowlistedCommand({ executable: "pwd", args: [] })).toBe(true);
    expect(isAllowlistedCommand({ executable: "node", args: ["--version"] })).toBe(true);
  });

  it("rejects privilege, scope expansion, writes and path escapes", () => {
    expect(isAllowlistedCommand({ executable: "sudo", args: ["ls"] })).toBe(false);
    expect(
      isAllowlistedCommand({ executable: "pnpm", args: ["test", "--prefix", "/outside"] }),
    ).toBe(false);
    expect(isAllowlistedCommand({ executable: "pnpm", args: ["exec", "rm", "-rf", "x"] })).toBe(
      false,
    );
    expect(isAllowlistedCommand({ executable: "pnpm", args: ["dlx", "foo"] })).toBe(false);
    expect(isAllowlistedCommand({ executable: "/tmp/pnpm", args: ["test"] })).toBe(false);
    expect(
      isAllowlistedCommand({ executable: "git", args: ["diff", "--no-index", "a", "b"] }),
    ).toBe(false);
    expect(isAllowlistedCommand({ executable: "git", args: ["branch", "-D", "main"] })).toBe(false);
    expect(isAllowlistedCommand({ executable: "rg", args: ["--pre", "script", "foo"] })).toBe(
      false,
    );
    expect(isAllowlistedCommand({ executable: "rg", args: ["foo", "/etc"] })).toBe(false);
    expect(isAllowlistedCommand({ executable: "rg", args: ["foo", "../secret"] })).toBe(false);
    expect(isAllowlistedCommand({ executable: "node", args: ["-e", "process.exit(0)"] })).toBe(
      false,
    );
  });

  it("allows only simple shell commands without metacharacters or quotes", () => {
    expect(isAllowlistedShellCommand({ command: "git status", cwd: "." })).toBe(true);
    expect(isAllowlistedShellCommand({ command: "pnpm test", cwd: "." })).toBe(true);
    expect(isAllowlistedShellCommand({ command: "rg needle src", cwd: "." })).toBe(true);
    expect(isAllowlistedShellCommand({ command: "ls -la", cwd: "." })).toBe(true);
    expect(isAllowlistedShellCommand({ command: "pwd", cwd: "." })).toBe(true);

    expect(isAllowlistedShellCommand({ command: "git status | head", cwd: "." })).toBe(false);
    expect(isAllowlistedShellCommand({ command: "pnpm test > out", cwd: "." })).toBe(false);
    expect(isAllowlistedShellCommand({ command: "pnpm test && rm x", cwd: "." })).toBe(false);
    expect(isAllowlistedShellCommand({ command: 'rg "foo" src', cwd: "." })).toBe(false);
    expect(isAllowlistedShellCommand({ command: "ls /etc", cwd: "." })).toBe(false);
    expect(isAllowlistedShellCommand({ command: "git branch -D main", cwd: "." })).toBe(false);
  });
});
