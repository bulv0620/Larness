import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { resolveManualShell, terminalLaunch } from "../../src/modules/terminals/shell.js";
import { withTempDir } from "../helpers.js";

it.skipIf(process.platform === "win32")(
  "uses an executable absolute account shell without interpreting command text",
  async () => {
    await withTempDir(async (dir) => {
      const executable = path.join(dir, "my shell");
      await writeFile(executable, '#!/bin/sh\nexec /bin/sh "$@"\n', { mode: 0o700 });
      expect(await resolveManualShell(executable)).toBe(executable);
      for (const invalid of ["sh", "", `${executable} -i`, path.join(dir, "missing"), dir])
        expect(await resolveManualShell(invalid)).toBe("/bin/sh");
      await chmod(executable, 0o600);
      expect(await resolveManualShell(executable)).toBe("/bin/sh");
      const folder = path.join(dir, "folder");
      await mkdir(folder);
      expect(await resolveManualShell(folder)).toBe("/bin/sh");
    });
  },
);

it.skipIf(process.platform === "win32")(
  "builds a fixed bootstrap with literal argv and no user content in script text",
  () => {
    const shell = "/account shell";
    const program = { executable: "/program name", args: ["$(touch nope)", "'\";", "\n\x03", ""] };
    expect(terminalLaunch(shell)).toEqual({ executable: shell, args: ["-i"] });
    const launch = terminalLaunch(shell, program);
    expect(launch.executable).toBe("/bin/sh");
    expect(launch.args.slice(3)).toEqual([shell, program.executable, ...program.args]);
    expect(launch.args[2]).not.toContain("touch nope");
    expect(launch.args[2]).toContain('(exec "$@")');
  },
);

it.skipIf(process.platform !== "win32")(
  "passes the selected interactive shell and fixed argv through the Node bootstrap",
  async () => {
    const shell = await resolveManualShell();
    expect(path.basename(shell).toLowerCase()).toMatch(/^(pwsh|powershell|cmd)\.exe$/);
    const interactive = terminalLaunch(shell);
    expect(interactive.executable).toBe(shell);
    const bootstrap = "C:\\larness\\windows-terminal-bootstrap.mjs";
    const readyFile = "C:\\larness\\term.ready";
    const launch = terminalLaunch(
      shell,
      { executable: process.execPath, args: ["--version"] },
      process.cwd(),
      bootstrap,
      readyFile,
    );
    expect(launch.executable).toBe(process.execPath);
    expect(launch.args).toEqual([
      bootstrap,
      readyFile,
      shell,
      JSON.stringify(interactive.args),
      process.execPath,
      "--version",
    ]);
  },
);

it.skipIf(process.platform !== "win32")(
  "uses Windows PowerShell when pwsh is missing or cannot be started",
  async () => {
    await withTempDir(async (dir) => {
      const previousPath = process.env.PATH;
      try {
        process.env.PATH = dir;
        const shell = await resolveManualShell();
        expect(path.basename(shell).toLowerCase()).toBe("powershell.exe");
        await writeFile(path.join(dir, "pwsh.exe"), "not an executable");
        expect(await resolveManualShell()).toBe(shell);
      } finally {
        process.env.PATH = previousPath;
      }
    });
  },
);

it.skipIf(process.platform !== "win32")(
  "uses system CMD if PowerShell is unavailable and fails when all candidates are unusable",
  async () => {
    const cmd = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
    await withTempDir(async (dir) => {
      const previousPath = process.env.PATH;
      const previousRoot = process.env.SystemRoot;
      try {
        process.env.PATH = dir;
        process.env.SystemRoot = dir;
        const system32 = path.join(dir, "System32");
        await mkdir(system32);
        const fallback = path.join(system32, "cmd.exe");
        await expect(resolveManualShell()).rejects.toThrow();
        await copyFile(cmd, fallback);
        expect(await resolveManualShell()).toBe(fallback);
      } finally {
        process.env.PATH = previousPath;
        process.env.SystemRoot = previousRoot;
      }
    });
  },
);
