import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectTurnFileResults,
  isProcessFile,
  type TurnFileChange,
} from "../../src/modules/agent/turnResults.js";
import { withTempDir } from "../helpers.js";

function change(
  filePath: string,
  changeType: "created" | "modified" = "created",
  version = "v1",
): TurnFileChange {
  return { path: filePath, changeType, version };
}

describe("turn result classification", () => {
  it("treats generated, temporary and ignored paths as process files", () => {
    expect(isProcessFile("tmp/probe.mjs")).toBe(true);
    expect(isProcessFile("dist/app.js")).toBe(true);
    expect(isProcessFile("build/out.js")).toBe(true);
    expect(isProcessFile("coverage/lcov.info")).toBe(true);
    expect(isProcessFile(".cache/report.json")).toBe(true);
    expect(isProcessFile("test-results/run.json")).toBe(true);
    expect(isProcessFile("playwright-report/index.html")).toBe(true);
    expect(isProcessFile("node_modules/pkg/index.js")).toBe(true);
    expect(isProcessFile(".larness/state.json")).toBe(true);
    expect(isProcessFile(".git/COMMIT_EDITMSG")).toBe(true);
    expect(isProcessFile("build.log")).toBe(true);
    expect(isProcessFile("notes.tmp")).toBe(true);
    expect(isProcessFile("notes.bak")).toBe(true);
    expect(isProcessFile("notes.orig")).toBe(true);
    expect(isProcessFile("notes.swp")).toBe(true);
  });

  it("keeps ordinary project files as deliverables", () => {
    expect(isProcessFile("docs/report.md")).toBe(false);
    expect(isProcessFile("src/tmpfile.ts")).toBe(false);
    expect(isProcessFile("src/tmp/helpers.ts")).toBe(true);
    expect(isProcessFile("logs/../app.ts")).toBe(false);
  });

  it("honors the project ignore list without changing the defaults", () => {
    expect(isProcessFile("generated/out.ts", ["generated"])).toBe(true);
    expect(isProcessFile("generated/out.ts", [])).toBe(false);
    expect(isProcessFile("node_modules/pkg/index.js", [])).toBe(true);
  });
});

describe("collectTurnFileResults", () => {
  it("marks deleted files as process and surviving files as deliverables", async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, "tmp"), { recursive: true });
      await writeFile(path.join(dir, "tmp", "probe.mjs"), "console.log(1)\n");
      await writeFile(path.join(dir, "docs.md"), "# doc\n");
      const changes = new Map<string, TurnFileChange>([
        ["tmp/probe.mjs", change("tmp/probe.mjs")],
        ["docs.md", change("docs.md", "modified", "v2")],
      ]);

      await rm(path.join(dir, "tmp", "probe.mjs"));

      const results = await collectTurnFileResults({ root: dir, changes: changes.values() });

      expect(results).toEqual([
        {
          path: "tmp/probe.mjs",
          changeType: "created",
          version: "v1",
          existed: false,
          category: "process",
        },
        {
          path: "docs.md",
          changeType: "modified",
          version: "v2",
          existed: true,
          category: "deliverable",
        },
      ]);
    });
  });

  it("keeps a file as deliverable when the check fails for a non-ENOENT reason", async () => {
    await withTempDir(async (dir) => {
      const changes = new Map<string, TurnFileChange>([
        ["bad\u0000name.txt", change("bad\u0000name.txt")],
      ]);
      const errors: string[] = [];

      const results = await collectTurnFileResults({
        root: dir,
        changes: changes.values(),
        onError: (filePath) => errors.push(filePath),
      });

      expect(results[0]).toMatchObject({ existed: true, category: "deliverable" });
      expect(errors).toEqual(["bad\u0000name.txt"]);
    });
  });

  it("caps the result list and preserves first-touch order", async () => {
    await withTempDir(async (dir) => {
      const changes = new Map<string, TurnFileChange>();
      for (const name of ["a.txt", "b.txt", "c.txt"]) {
        await writeFile(path.join(dir, name), name);
        changes.set(name, change(name));
      }

      const results = await collectTurnFileResults({
        root: dir,
        changes: changes.values(),
        limit: 2,
      });

      expect(results.map((result) => result.path)).toEqual(["a.txt", "b.txt"]);
    });
  });
});
