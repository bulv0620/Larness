import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers.js";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const appEntry = path.join(root, "app.js");

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [appEntry, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("app.js entrypoint", () => {
  it("prints the version", () => {
    const result = run(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints usage for --help", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("larness start");
    expect(result.stdout).toContain("larness logs");
    expect(result.stdout).toContain("LARNESS_DATA_DIR");
  });

  it("treats a bare invocation as help without touching the data directory", async () => {
    await withTempDir(async (dir) => {
      const dataDir = path.join(dir, "data");
      const bare = run([], { LARNESS_DATA_DIR: dataDir });
      const help = run(["--help"], { LARNESS_DATA_DIR: dataDir });

      expect(bare.status).toBe(0);
      expect(bare.stdout).toBe(help.stdout);
      expect(existsSync(dataDir)).toBe(false);
    });
  });

  it("exits non-zero for unknown commands", () => {
    const result = run(["unknown-command"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown command");
  });

  it("exits 2 for invalid options", () => {
    const result = run(["logs", "--lines", "0"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--lines expects");
  });
});
