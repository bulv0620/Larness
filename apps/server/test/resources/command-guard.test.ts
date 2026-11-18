import { isInteractiveExecutable, isInteractiveShellCommand } from "@larness/resources";
import { describe, expect, it } from "vitest";

describe("interactive command guard", () => {
  it("rejects TUI executables and interactive Git rebases", () => {
    expect(isInteractiveExecutable("vim", [])).toBe(true);
    expect(isInteractiveExecutable("/usr/bin/htop", [])).toBe(true);
    expect(isInteractiveExecutable("git", ["rebase", "-i", "HEAD~2"])).toBe(true);
  });

  it("allows finite non-interactive commands", () => {
    expect(isInteractiveExecutable(process.execPath, ["-e", "0"])).toBe(false);
    expect(isInteractiveExecutable("git", ["status"])).toBe(false);
    expect(isInteractiveExecutable("git", ["rebase", "main"])).toBe(false);
  });

  it("rejects TUI commands and bare shells inside run_shell", () => {
    expect(isInteractiveShellCommand("vim src/a.ts")).toBe(true);
    expect(isInteractiveShellCommand("bash")).toBe(true);
    expect(isInteractiveShellCommand("zsh -i")).toBe(true);
    expect(isInteractiveShellCommand("git rebase -i HEAD~2")).toBe(true);
  });

  it("allows finite shell pipelines and shell -c invocations", () => {
    expect(isInteractiveShellCommand("pnpm test 2>&1 | tail -n 40")).toBe(false);
    expect(isInteractiveShellCommand("bash -c 'echo ok'")).toBe(false);
    expect(isInteractiveShellCommand("git commit -m 'x'")).toBe(false);
  });
});
