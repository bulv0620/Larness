import { chmodSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensurePtySpawnHelper } from "../src/platform/pty.js";

describe("pty helper permissions", () => {
  it("restores the macOS spawn-helper executable bit", () => {
    if (process.platform !== "darwin") return;
    const require = createRequire(import.meta.url);
    const root = path.dirname(require.resolve("node-pty/package.json"));
    const helper = path.join(root, `prebuilds/darwin-${process.arch}/spawn-helper`);
    chmodSync(helper, 0o644);
    ensurePtySpawnHelper();
    expect(statSync(helper).mode & 0o777).toBe(0o755);
  });
});
