import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPatch } from "diff";
import { describe, expect, it } from "vitest";
import { createFileToolRegistry } from "../../src/index.js";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "larness-tools-"));
  const real = await realpath(dir);
  try {
    return await run(real);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("file tools", () => {
  it("exposes list/read/search/patch with risk levels and summaries", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "a.txt"), "one\ntwo\n");
      await writeFile(path.join(dir, "b.txt"), "needle\n");

      const registry = createFileToolRegistry();
      expect(registry.list()).toEqual([
        { name: "list_files", description: expect.any(String), riskLevel: "L0" },
        { name: "read_file", description: expect.any(String), riskLevel: "L0" },
        { name: "search_code", description: expect.any(String), riskLevel: "L0" },
        { name: "write_file", description: expect.any(String), riskLevel: "L1" },
        { name: "apply_patch", description: expect.any(String), riskLevel: "L1" },
      ]);

      const list = await registry.execute("list_files", { path: "." }, { projectRoot: dir });
      expect(list).toMatchObject({ ok: true, truncated: false });
      expect((list.data as { files: { path: string }[] }).files.map((entry) => entry.path)).toEqual(
        expect.arrayContaining(["a.txt", "b.txt"]),
      );

      const read = await registry.execute("read_file", { path: "a.txt" }, { projectRoot: dir });
      expect(read).toMatchObject({ ok: true, truncated: false });
      const readData = read.data as { content: string; version: string };
      expect(readData.content).toBe("one\ntwo\n");
      expect(readData.version).toMatch(/^[a-f0-9]{64}$/);

      const search = await registry.execute(
        "search_code",
        { query: "needle" },
        { projectRoot: dir },
      );
      expect(search).toMatchObject({ ok: true });
      expect((search.data as { matches: unknown[] }).matches).toHaveLength(1);

      const created = await registry.execute(
        "write_file",
        { path: "nested/new.txt", content: "hello\n" },
        { projectRoot: dir },
      );
      expect(created).toMatchObject({ ok: true });
      expect(created.summary).toMatch(/created nested\/new\.txt/);

      const patch = createPatch("a.txt", "one\ntwo\n", "one\nTWO\n");
      const applied = await registry.execute(
        "apply_patch",
        { path: "a.txt", expectedVersion: readData.version, patch },
        { projectRoot: dir },
      );
      expect(applied).toMatchObject({ ok: true });
      expect(applied.summary).toMatch(/patched a\.txt \(\+1 -1\)/);

      const updated = await registry.execute("read_file", { path: "a.txt" }, { projectRoot: dir });
      expect((updated.data as { content: string }).content).toBe("one\nTWO\n");
    });
  });

  it("returns VERSION_CONFLICT with the current version", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "a.txt"), "one\n");
      const registry = createFileToolRegistry();
      const read = await registry.execute("read_file", { path: "a.txt" }, { projectRoot: dir });
      const version = (read.data as { version: string }).version;
      const patch = createPatch("a.txt", "one\n", "two\n");
      await writeFile(path.join(dir, "a.txt"), "changed\n");

      const result = await registry.execute(
        "apply_patch",
        { path: "a.txt", expectedVersion: version, patch },
        { projectRoot: dir },
      );
      expect(result).toMatchObject({
        ok: false,
        errorCode: "VERSION_CONFLICT",
        data: { currentVersion: expect.stringMatching(/^[a-f0-9]{64}$/) },
      });
    });
  });

  it("rejects schema violations and path escapes", async () => {
    await withTempDir(async (dir) => {
      const registry = createFileToolRegistry();

      const invalid = await registry.execute(
        "apply_patch",
        { path: "a.txt", patch: "x" },
        { projectRoot: dir },
      );
      expect(invalid).toMatchObject({ ok: false, errorCode: "VALIDATION_ERROR" });

      await writeFile(path.join(dir, "a.txt"), "x");
      const escaped = await registry.execute(
        "read_file",
        { path: "../outside.txt" },
        { projectRoot: dir },
      );
      expect(escaped).toMatchObject({ ok: false, errorCode: "PATH_OUTSIDE_PROJECT" });

      const missing = await registry.execute(
        "read_file",
        { path: "missing.txt" },
        { projectRoot: dir },
      );
      expect(missing).toMatchObject({ ok: false, errorCode: "NOT_FOUND" });
    });
  });
});
