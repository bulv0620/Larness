import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalDirectory, PathGuardError, resolveInsideRoot } from "@larness/resources";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers.js";

describe("resource path guard", () => {
  it("resolves existing and future files only inside the canonical root", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "src", "index.ts"), "export {};\n");
      const rootReal = await canonicalDirectory(root);

      await expect(resolveInsideRoot(rootReal, "src/index.ts")).resolves.toBe(
        path.join(rootReal, "src", "index.ts"),
      );
      await expect(resolveInsideRoot(rootReal, "src/new-file.ts")).resolves.toBe(
        path.join(rootReal, "src", "new-file.ts"),
      );
      await expect(resolveInsideRoot(rootReal, ".")).resolves.toBe(rootReal);
    });
  });

  it("rejects traversal, NUL, empty paths and outside siblings", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      const outside = path.join(dir, "outside");
      await mkdir(root, { recursive: true });
      await mkdir(outside, { recursive: true });
      await writeFile(path.join(outside, "secret.txt"), "secret");
      const rootReal = await canonicalDirectory(root);

      for (const candidate of ["../outside/secret.txt", path.join(outside, "secret.txt")]) {
        await expect(resolveInsideRoot(rootReal, candidate)).rejects.toMatchObject({
          code: "PATH_OUTSIDE_PROJECT",
        });
      }

      await expect(resolveInsideRoot(rootReal, "")).rejects.toBeInstanceOf(PathGuardError);
      await expect(resolveInsideRoot(rootReal, "a\0b")).rejects.toMatchObject({
        code: "INVALID_PATH",
      });
    });
  });

  it.skipIf(process.platform === "win32")("rejects symlink escapes", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      const outside = path.join(dir, "outside");
      await mkdir(root, { recursive: true });
      await mkdir(outside, { recursive: true });
      await writeFile(path.join(outside, "secret.txt"), "secret");
      await symlink(outside, path.join(root, "link"));
      const rootReal = await canonicalDirectory(root);

      await expect(resolveInsideRoot(rootReal, "link/secret.txt")).rejects.toMatchObject({
        code: "PATH_OUTSIDE_PROJECT",
      });
    });
  });

  it("supports unicode paths and rejects files as project roots", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "项目");
      await mkdir(path.join(root, "文档"), { recursive: true });
      await writeFile(path.join(root, "文档", "说明.md"), "# hi");
      const rootReal = await canonicalDirectory(root);

      await expect(resolveInsideRoot(rootReal, "文档/说明.md")).resolves.toBe(
        path.join(rootReal, "文档", "说明.md"),
      );

      await expect(canonicalDirectory(path.join(root, "文档", "说明.md"))).rejects.toMatchObject({
        code: "INVALID_PATH",
      });
    });
  });
});
