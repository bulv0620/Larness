import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const appEntry = path.join(root, "app.js");

function run(...args: string[]) {
  return spawnSync(process.execPath, [appEntry, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

describe("app.js entrypoint", () => {
  it("prints the version", () => {
    const result = run("--version");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("prints usage for --help", () => {
    const result = run("--help");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("node app.js status");
    expect(result.stdout).toContain("LARNESS_DATA_DIR");
  });

  it("exits non-zero for unknown commands", () => {
    const result = run("unknown-command");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown command");
  });
});
