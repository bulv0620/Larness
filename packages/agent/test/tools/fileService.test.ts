import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyPatch, hashContent, listFiles, readTextFile, searchCode } from "@larness/resources";
import { createPatch } from "diff";
import { describe, expect, it } from "vitest";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "larness-files-"));
  const real = await realpath(dir);
  try {
    return await run(real);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("file service", () => {
  it("lists project files while skipping ignored and symlinked entries", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "README.md"), "hello\n");
      await writeFile(path.join(dir, "binary.bin"), Buffer.from([0, 1, 2]));
      await writeFile(path.join(dir, "outside-secret.txt"), "secret\n");

      await mkdir(path.join(dir, "src"));
      await mkdir(path.join(dir, "node_modules"));
      await mkdir(path.join(dir, ".git"));
      await mkdir(path.join(dir, "dist"));
      await writeFile(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
      await writeFile(path.join(dir, "node_modules", "skip.js"), "skip\n");
      await writeFile(path.join(dir, ".git", "config"), "git\n");
      await writeFile(path.join(dir, "dist", "out.js"), "built\n");

      if (process.platform !== "win32") {
        await symlink(path.join(dir, "outside-secret.txt"), path.join(dir, "link.txt"));
      }

      const result = await listFiles(dir, { ignore: ["dist/"] });
      const paths = result.files.map((entry) => entry.path);

      expect(paths).toEqual(expect.arrayContaining(["README.md", "src", "src/a.ts"]));
      expect(paths).not.toContain("node_modules");
      expect(paths).not.toContain(".git");
      expect(paths).not.toContain("dist");
      expect(paths).not.toContain("dist/out.js");
      if (process.platform !== "win32") {
        expect(paths).not.toContain("link.txt");
      }
      expect(result.truncated).toBe(false);
    });
  });

  it("marks list output as truncated when the limit is exceeded", async () => {
    await withTempDir(async (dir) => {
      for (let index = 0; index < 5; index += 1) {
        await writeFile(path.join(dir, `file-${index}.txt`), "x");
      }

      const result = await listFiles(dir, { limit: 3 });
      expect(result.files).toHaveLength(3);
      expect(result.truncated).toBe(true);
    });
  });

  it("reads a file with a sha256 version and supports line ranges", async () => {
    await withTempDir(async (dir) => {
      const content = "line1\nline2\nline3\nline4\n";
      await writeFile(path.join(dir, "notes.txt"), content);

      const full = await readTextFile(dir, { path: "notes.txt" });
      expect(full.version).toBe(hashContent(Buffer.from(content, "utf8")));
      expect(full.content).toBe("line1\nline2\nline3\nline4\n");
      expect(full.totalLines).toBe(5);
      expect(full.truncated).toBe(false);

      const range = await readTextFile(dir, { path: "notes.txt", offset: 2, limit: 2 });
      expect(range.content).toBe("line2\nline3");
      expect(range.truncated).toBe(true);
      expect(range.offset).toBe(2);
      expect(range.nextOffset).toBe(4);

      const rest = await readTextFile(dir, { path: "notes.txt", offset: range.nextOffset });
      expect(rest.content.trimEnd()).toBe("line4");
      expect(rest.truncated).toBe(false);
      expect(rest.nextOffset).toBe(6);

      const beyond = await readTextFile(dir, { path: "notes.txt", offset: 99 });
      expect(beyond.content).toBe("");
      expect(beyond.truncated).toBe(false);
    });
  });

  it("rejects non-text and oversized files", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "binary.bin"), Buffer.from([0, 1, 2, 3]));

      await expect(readTextFile(dir, { path: "binary.bin" })).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });

      await writeFile(path.join(dir, "large.txt"), "a".repeat(1_048_577));
      await expect(readTextFile(dir, { path: "large.txt" })).rejects.toMatchObject({
        code: "TOO_LARGE",
      });
    });
  });

  it("searches text files with a bounded result set", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "a.txt"), "needle one\nother\n");
      await writeFile(path.join(dir, "b.txt"), "NEEDLE two\n");
      await writeFile(path.join(dir, "c.bin"), Buffer.from([0, 110, 101, 101, 100, 108, 101]));

      const sensitive = await searchCode(dir, { query: "needle", caseSensitive: true });
      expect(sensitive.matches).toEqual([{ path: "a.txt", line: 1, preview: "needle one" }]);
      expect(sensitive.scannedFiles).toBe(2);

      const insensitive = await searchCode(dir, { query: "needle", limit: 1 });
      expect(insensitive.matches).toHaveLength(1);
      expect(insensitive.truncated).toBe(true);
      expect(insensitive.scannedFiles).toBe(2);
    });
  });

  it("caps read output at 2000 lines", async () => {
    await withTempDir(async (dir) => {
      const content = Array.from({ length: 2_001 }, (_, index) => `line ${index}`).join("\n");
      await writeFile(path.join(dir, "long.txt"), content);

      const result = await readTextFile(dir, { path: "long.txt" });
      expect(result.truncated).toBe(true);
      expect(result.content.split("\n")).toHaveLength(2_000);
      expect(result.totalLines).toBe(2_001);
    });
  });

  it("applies a patch only for the expected version", async () => {
    await withTempDir(async (dir) => {
      const original = "one\ntwo\n";
      await writeFile(path.join(dir, "a.txt"), original);
      const { version } = await readTextFile(dir, { path: "a.txt" });
      const patch = createPatch("a.txt", original, "one\nTWO\n");

      const applied = await applyPatch(dir, {
        path: "a.txt",
        expectedVersion: version,
        patch,
      });
      expect(applied.previousVersion).toBe(version);
      expect(applied.additions).toBe(1);
      expect(applied.deletions).toBe(1);
      expect(await readTextFile(dir, { path: "a.txt" })).toMatchObject({
        content: "one\nTWO\n",
        version: applied.version,
      });

      await expect(
        applyPatch(dir, { path: "a.txt", expectedVersion: version, patch }),
      ).rejects.toMatchObject({
        code: "VERSION_CONFLICT",
        details: { currentVersion: applied.version },
      });

      await expect(
        applyPatch(dir, {
          path: "a.txt",
          expectedVersion: applied.version,
          patch: "not a patch",
        }),
      ).rejects.toMatchObject({ code: "INVALID_PATCH" });
    });
  });

  it("rejects traversal and symlink escapes", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "root");
      const outside = path.join(dir, "outside.txt");
      await mkdir(root);
      await writeFile(outside, "secret\n");

      await expect(readTextFile(root, { path: "../outside.txt" })).rejects.toMatchObject({
        code: "PATH_OUTSIDE_PROJECT",
      });

      if (process.platform !== "win32") {
        await symlink(outside, path.join(root, "escape.txt"));
        await expect(readTextFile(root, { path: "escape.txt" })).rejects.toMatchObject({
          code: "PATH_OUTSIDE_PROJECT",
        });
      }
    });
  });
});
