import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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
  it("exposes list/read/search/write/edit/patch with risk levels and summaries", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "a.txt"), "one\ntwo\n");
      await writeFile(path.join(dir, "b.txt"), "needle\n");

      const registry = createFileToolRegistry();
      expect(registry.list()).toEqual([
        { name: "list_files", description: expect.any(String), riskLevel: "L0" },
        { name: "read_file", description: expect.any(String), riskLevel: "L0" },
        { name: "search_code", description: expect.any(String), riskLevel: "L0" },
        { name: "write_file", description: expect.any(String), riskLevel: "L1" },
        { name: "edit", description: expect.any(String), riskLevel: "L1" },
        { name: "apply_patch", description: expect.any(String), riskLevel: "L1" },
      ]);

      const listTool = registry.get("list_files");
      expect(listTool?.summarize?.({})).toBe("list .");
      expect(listTool?.summarize?.({ path: "src" })).toBe("list src");

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
      expect(read.modelText).toContain(`version: ${readData.version}`);
      expect(read.modelText).toContain("1: one");
      expect(read.modelText).toContain("2: two");

      await writeFile(
        path.join(dir, "big.txt"),
        Array.from({ length: 1_200 }, (_, index) => `row ${index} ${"q".repeat(70)}`).join("\n"),
      );
      const paged = await registry.execute("read_file", { path: "big.txt" }, { projectRoot: dir });
      expect(paged).toMatchObject({ ok: true, truncated: true });
      expect(paged.summary).toMatch(/lines 1–\d+ of 1200/);
      expect(paged.summary).toMatch(/next offset=\d+/);
      expect((paged.data as { content: string }).content).not.toContain("chars omitted");

      const search = await registry.execute(
        "search_code",
        { query: "needle" },
        { projectRoot: dir },
      );
      expect(search).toMatchObject({ ok: true });
      expect((search.data as { matches: unknown[] }).matches).toHaveLength(1);
      expect(search.modelText).toMatch(/^1 matches in \d+ files/);
      expect(search.modelText).toContain("b.txt:1: needle");
      expect(search.modelText).not.toContain('"matches"');

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

  it("edits exact text and replaces files with write_file", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "a.txt"), "one\ntwo\n");
      const registry = createFileToolRegistry();

      const edited = await registry.execute(
        "edit",
        { path: "a.txt", oldString: "two", newString: "TWO" },
        { projectRoot: dir },
      );
      expect(edited).toMatchObject({
        ok: true,
        data: { path: "a.txt", replacements: 1 },
      });
      expect(
        (await registry.execute("read_file", { path: "a.txt" }, { projectRoot: dir })).data,
      ).toMatchObject({ content: "one\nTWO\n" });

      const repaired = await registry.execute(
        "edit",
        { file_path: "a.txt", old_string: "TWO", new_string: "two" },
        { projectRoot: dir },
      );
      expect(repaired).toMatchObject({ ok: true, data: { replacements: 1 } });

      await writeFile(path.join(dir, "multi.txt"), "x\nx\n");
      const ambiguous = await registry.execute(
        "edit",
        { path: "multi.txt", oldString: "x", newString: "y" },
        { projectRoot: dir },
      );
      expect(ambiguous).toMatchObject({ ok: false, errorCode: "INVALID_PATCH" });

      const read = await registry.execute("read_file", { path: "a.txt" }, { projectRoot: dir });
      const version = (read.data as { version: string }).version;
      const replaced = await registry.execute(
        "write_file",
        { path: "a.txt", content: "replaced\n", expectedVersion: version },
        { projectRoot: dir },
      );
      expect(replaced).toMatchObject({ ok: true, data: { created: false } });
      expect(
        (await registry.execute("read_file", { path: "a.txt" }, { projectRoot: dir })).data,
      ).toMatchObject({ content: "replaced\n" });

      const stale = await registry.execute(
        "write_file",
        { path: "a.txt", content: "stale\n", expectedVersion: "0".repeat(64) },
        { projectRoot: dir },
      );
      expect(stale).toMatchObject({ ok: false, errorCode: "VERSION_CONFLICT" });

      const created = await registry.execute(
        "write_file",
        { path: "new.txt", content: "new\n" },
        { projectRoot: dir },
      );
      expect(created).toMatchObject({ ok: true, data: { created: true } });
    });
  });

  it("numbers read pages and keeps the full version in model text", async () => {
    await withTempDir(async (dir) => {
      const content = Array.from(
        { length: 1_200 },
        (_, index) => `row ${index} ${"q".repeat(70)}`,
      ).join("\n");
      await writeFile(path.join(dir, "big.txt"), `${content}\n`);

      const registry = createFileToolRegistry();
      const read = await registry.execute("read_file", { path: "big.txt" }, { projectRoot: dir });
      expect(read).toMatchObject({ ok: true, truncated: true });
      const data = read.data as {
        content: string;
        version: string;
        nextOffset: number;
      };

      expect(data.nextOffset).toBeGreaterThan(300);
      expect(read.modelText).toContain(`version: ${data.version}`);
      expect(read.modelText).toContain("1: row 0");
      expect(read.modelText).toContain(`next offset=${data.nextOffset}`);
      expect(data.content.startsWith("row 0 ")).toBe(true);
      expect(data.content).not.toContain("1: row 0");
    });
  });

  it("hides common build directories from the model by default", async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, ".pnpm-store", "v11"), { recursive: true });
      await mkdir(path.join(dir, "dist"), { recursive: true });
      await mkdir(path.join(dir, "src"), { recursive: true });
      await writeFile(path.join(dir, ".pnpm-store", "v11", "needle.ts"), "needle\n");
      await writeFile(path.join(dir, "dist", "needle.js"), "needle\n");
      await writeFile(path.join(dir, "src", "needle.ts"), "needle\n");

      const registry = createFileToolRegistry();
      expect(registry.get("list_files")?.description).toContain("Common build/output directories");
      expect(registry.get("search_code")?.description).toContain("pass `path` explicitly");

      const listed = await registry.execute(
        "list_files",
        { path: ".", depth: 3 },
        { projectRoot: dir },
      );
      const paths = (listed.data as { files: { path: string }[] }).files.map((entry) => entry.path);
      expect(paths).toEqual(expect.arrayContaining(["src", "src/needle.ts"]));
      expect(paths.some((entry) => entry.startsWith(".pnpm-store"))).toBe(false);
      expect(paths.some((entry) => entry.startsWith("dist"))).toBe(false);

      const searched = await registry.execute(
        "search_code",
        { query: "needle" },
        { projectRoot: dir },
      );
      expect(
        (searched.data as { matches: { path: string }[] }).matches.map((match) => match.path),
      ).toEqual(["src/needle.ts"]);
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
