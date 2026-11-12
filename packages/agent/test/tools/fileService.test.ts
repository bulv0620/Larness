import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  applyPatch,
  createTextFile,
  hashContent,
  listFiles,
  readTextFile,
  searchCode,
} from "@larness/resources";
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

  it("narrows the scan with glob and budget and can return context lines", async () => {
    await withTempDir(async (dir) => {
      await mkdir(path.join(dir, "src"), { recursive: true });
      await mkdir(path.join(dir, "docs"), { recursive: true });
      await writeFile(path.join(dir, "src", "one.ts"), "before\ntarget here\nafter\n");
      await writeFile(path.join(dir, "src", "two.ts"), "target again\n");
      await writeFile(path.join(dir, "docs", "guide.md"), "target in docs\n");

      const scoped = await searchCode(dir, { query: "target", glob: "src/*.ts" });
      expect(scoped.matches.map((match) => match.path).sort()).toEqual([
        "src/one.ts",
        "src/two.ts",
      ]);

      const withContext = await searchCode(dir, {
        query: "target",
        path: "src/one.ts",
        contextLines: 1,
      });
      expect(withContext.matches[0]?.context).toBe("before\ntarget here\nafter");

      const budgeted = await searchCode(dir, { query: "target", maxFiles: 1 });
      expect(budgeted.scannedFiles).toBe(1);
      expect(budgeted.scanBudgetExhausted).toBe(true);
    });
  });

  it("repairs common model patch shapes before applying", async () => {
    await withTempDir(async (dir) => {
      const original = "const re = /\\d+/;\nvalue = 1;\n";
      await writeFile(path.join(dir, "app.js"), original);
      const { version } = await readTextFile(dir, { path: "app.js" });
      const body = ["@@ -1,2 +1,2 @@", " const re = /\\d+/;", "-value = 1;", "+value = 2;"].join(
        "\n",
      );

      const shapes = [
        body,
        `\`\`\`diff\n${body}\n\`\`\``,
        `--- a/app.js\n+++ b/app.js\n${body}`,
        `Here is the patch:\n--- a/app.js\n+++ b/app.js\n${body}`,
        body.replace(/\n/g, "\\n"),
        `--- a/app.js\r\n+++ b/app.js\r\n${body.replace(/\n/g, "\r\n")}`,
      ];

      for (const patch of shapes) {
        const applied = await applyPatch(dir, {
          path: "app.js",
          expectedVersion: version,
          patch,
        });
        expect(applied.additions).toBe(1);
        expect((await readTextFile(dir, { path: "app.js" })).content).toBe(
          "const re = /\\d+/;\nvalue = 2;\n",
        );
        // Restore for the next shape.
        await writeFile(path.join(dir, "app.js"), original);
      }
    });
  });

  it("recalculates a miscounted hunk header instead of rejecting the patch", async () => {
    await withTempDir(async (dir) => {
      const original = "one\ntwo\nthree\nfour\n";
      await writeFile(path.join(dir, "a.txt"), original);
      const { version } = await readTextFile(dir, { path: "a.txt" });
      // Declared 9/9, but the body has 3 old and 3 new lines.
      const patch = ["@@ -2,9 +2,9 @@", " two", "-three", "+THREE", " four"].join("\n");

      const applied = await applyPatch(dir, {
        path: "a.txt",
        expectedVersion: version,
        patch,
      });

      expect(applied.additions).toBe(1);
      expect(applied.deletions).toBe(1);
      expect((await readTextFile(dir, { path: "a.txt" })).content).toBe("one\ntwo\nTHREE\nfour\n");
    });
  });

  it("treats bare hunk lines and blank lines as context", async () => {
    await withTempDir(async (dir) => {
      const original = "alpha\n\nbeta\n";
      await writeFile(path.join(dir, "b.txt"), original);
      const { version } = await readTextFile(dir, { path: "b.txt" });
      // "alpha" and the empty line lost their leading space.
      const patch = ["@@ -1,3 +1,3 @@", "alpha", "", "-beta", "+gamma"].join("\n");

      const applied = await applyPatch(dir, {
        path: "b.txt",
        expectedVersion: version,
        patch,
      });

      expect(applied.additions).toBe(1);
      expect((await readTextFile(dir, { path: "b.txt" })).content).toBe("alpha\n\ngamma\n");
    });
  });

  it("still fails closed when the repaired context does not match the file", async () => {
    await withTempDir(async (dir) => {
      const original = "one\ntwo\n";
      await writeFile(path.join(dir, "c.txt"), original);
      const { version } = await readTextFile(dir, { path: "c.txt" });
      const patch = ["@@ -1,2 +1,2 @@", " nope", "-two", "+TWO"].join("\n");

      let message = "";
      try {
        await applyPatch(dir, { path: "c.txt", expectedVersion: version, patch });
      } catch (error) {
        message = (error as { message?: string }).message ?? "";
      }

      expect(message).toContain("does not match the file");
      expect((await readTextFile(dir, { path: "c.txt" })).content).toBe(original);
    });
  });

  it("explains why an unparsable patch was rejected", async () => {
    await withTempDir(async (dir) => {
      const original = "one\n";
      await writeFile(path.join(dir, "a.txt"), original);
      const { version } = await readTextFile(dir, { path: "a.txt" });

      await expect(
        applyPatch(dir, { path: "a.txt", expectedVersion: version, patch: "not a patch" }),
      ).rejects.toMatchObject({
        code: "INVALID_PATCH",
      });

      let message = "";
      try {
        await applyPatch(dir, { path: "a.txt", expectedVersion: version, patch: "not a patch" });
      } catch (error) {
        message = (error as { message?: string }).message ?? "";
      }

      expect(message).toContain("missing @@ hunk header");
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

  it("creates a new file once, including parent directories", async () => {
    await withTempDir(async (dir) => {
      const created = await createTextFile(dir, {
        path: "src/components/new.ts",
        content: "export const a = 1;\n",
      });

      expect(created).toMatchObject({ path: "src/components/new.ts", created: true, lines: 2 });
      expect(created.version).toBe(hashContent(Buffer.from("export const a = 1;\n", "utf8")));
      expect(await readTextFile(dir, { path: "src/components/new.ts" })).toMatchObject({
        content: "export const a = 1;\n",
        version: created.version,
      });

      await expect(
        createTextFile(dir, { path: "src/components/new.ts", content: "other" }),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });

      await expect(
        createTextFile(dir, { path: "../escape.ts", content: "x" }),
      ).rejects.toMatchObject({ code: "PATH_OUTSIDE_PROJECT" });

      await expect(
        createTextFile(dir, { path: "big.ts", content: "a".repeat(1_048_577) }),
      ).rejects.toMatchObject({ code: "TOO_LARGE" });

      await expect(
        createTextFile(dir, { path: "binary.ts", content: "a\0b" }),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
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
