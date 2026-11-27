import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  canonicalDirectory,
  PathGuardError,
  resolveInsideRoot,
  resolveReadPath,
} from "@larness/resources";
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

  it("reads outside the primary root only when external access is enabled", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      const outside = path.join(dir, "reference");
      const dataDir = path.join(dir, "data");
      await mkdir(path.join(root, "src"), { recursive: true });
      await mkdir(outside, { recursive: true });
      await mkdir(path.join(dataDir, "secrets"), { recursive: true });
      await writeFile(path.join(root, "src", "index.ts"), "export {};\n");
      await writeFile(path.join(outside, "api.md"), "# api\n");
      await writeFile(path.join(dataDir, "secrets", "master.key"), "k");

      const rootReal = await canonicalDirectory(root);
      const outsideReal = await realpath(outside);
      const dataReal = await realpath(dataDir);

      await expect(
        resolveReadPath({ root: rootReal }, path.join(outside, "api.md")),
      ).rejects.toMatchObject({ code: "PATH_OUTSIDE_PROJECT" });

      const policy = { root: rootReal, allowExternal: true, protectedRoots: [dataReal] };
      await expect(resolveReadPath(policy, path.join(outside, "api.md"))).resolves.toEqual({
        absolutePath: path.join(outsideReal, "api.md"),
        rootScope: "external",
      });
      await expect(
        resolveReadPath(policy, path.join(rootReal, "src", "index.ts")),
      ).resolves.toEqual({
        absolutePath: path.join(rootReal, "src", "index.ts"),
        rootScope: "primary",
      });
      await expect(resolveReadPath(policy, "src/index.ts")).resolves.toEqual({
        absolutePath: path.join(rootReal, "src", "index.ts"),
        rootScope: "primary",
      });
      await expect(resolveReadPath(policy, "../outside/api.md")).rejects.toMatchObject({
        code: "PATH_OUTSIDE_PROJECT",
      });

      await expect(
        resolveReadPath(policy, path.join(dataReal, "secrets", "master.key")),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  it("rejects root-level targets to avoid accidental whole-disk scans", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      await mkdir(root, { recursive: true });
      const rootReal = await canonicalDirectory(root);
      const policy = { root: rootReal, allowExternal: true };
      const filesystemRoot = path.parse(rootReal).root;

      await expect(resolveReadPath(policy, filesystemRoot)).rejects.toMatchObject({
        code: "INVALID_PATH",
      });
      await expect(resolveReadPath(policy, os.homedir())).rejects.toMatchObject({
        code: "INVALID_PATH",
      });
    });
  });

  it.skipIf(process.platform !== "linux")("rejects Linux pseudo filesystems", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      await mkdir(root, { recursive: true });
      const rootReal = await canonicalDirectory(root);
      const policy = { root: rootReal, allowExternal: true };

      for (const target of ["/proc/self/environ", "/sys/kernel", "/dev/null"]) {
        await expect(resolveReadPath(policy, target)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
    });
  });

  it.skipIf(process.platform === "win32")(
    "rejects symlinks that resolve into a protected root",
    async () => {
      await withTempDir(async (dir) => {
        const root = path.join(dir, "project");
        const dataDir = path.join(dir, "data");
        await mkdir(root, { recursive: true });
        await mkdir(path.join(dataDir, "secrets"), { recursive: true });
        await writeFile(path.join(dataDir, "secrets", "master.key"), "k");
        await symlink(dataDir, path.join(root, "link"));
        const rootReal = await canonicalDirectory(root);
        const dataReal = await realpath(dataDir);

        await expect(
          resolveReadPath(
            { root: rootReal, allowExternal: true, protectedRoots: [dataReal] },
            path.join(rootReal, "link", "secrets", "master.key"),
          ),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      });
    },
  );

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
