import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATA_SUBDIRS,
  DataDirError,
  defaultDataDir,
  ensureDataDirs,
  resolveDataDir,
} from "../src/platform/paths.js";
import { withTempDir } from "./helpers.js";

const posixOnly = process.platform === "win32" ? it.skip : it;

describe("resolveDataDir", () => {
  it("honours LARNESS_DATA_DIR", () => {
    expect(resolveDataDir({ LARNESS_DATA_DIR: "/tmp/custom-larness" })).toBe(
      path.resolve("/tmp/custom-larness"),
    );
  });

  it("falls back to the OS data directory", () => {
    expect(resolveDataDir({})).toBe(defaultDataDir());
    expect(defaultDataDir()).toContain("larness");
  });
});

describe("ensureDataDirs", () => {
  posixOnly("creates the root and all subdirectories with 0700", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "data");
      const result = await ensureDataDirs(root);

      expect(result.created).toBe(true);
      expect((await stat(root)).mode & 0o777).toBe(0o700);

      for (const name of DATA_SUBDIRS) {
        const info = await stat(path.join(root, name));
        expect(info.isDirectory()).toBe(true);
        expect(info.mode & 0o777).toBe(0o700);
      }
    });
  });

  posixOnly("hardens an existing world-readable directory to 0700", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "data");
      await mkdir(root, { mode: 0o755 });

      const result = await ensureDataDirs(root);

      expect(result.hardened).toBe(true);
      expect((await stat(root)).mode & 0o777).toBe(0o700);
    });
  });

  posixOnly("rejects a read-only data directory", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "data");
      await mkdir(root, { mode: 0o700 });
      await chmod(root, 0o500);

      await expect(ensureDataDirs(root)).rejects.toBeInstanceOf(DataDirError);
    });
  });

  it("rejects a path that is a file", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "data");
      await writeFile(root, "not a directory");

      await expect(ensureDataDirs(root)).rejects.toBeInstanceOf(DataDirError);
    });
  });
});
