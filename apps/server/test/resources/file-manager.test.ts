import {
  chmod,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { FileManagerError, readEditableFile, saveEditableFile } from "@larness/resources";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers.js";

describe("complete editable file IO", () => {
  it("does not delete an existing file when exclusive temporary creation fails", async () => {
    await withTempDir(async (dir) => {
      const root = await realpath(dir);
      const target = path.join(root, "file");
      const temporaryName = ".larness-save-existing-user-file";
      await writeFile(target, "original");
      await writeFile(path.join(root, temporaryName), "preserve existing content");
      const original = await readEditableFile(root, "file");
      await expect(
        saveEditableFile(
          root,
          { path: "file", content: "new", expectedVersion: original.version },
          {
            beforeCommit: () => {},
            temporaryName,
          },
        ),
      ).rejects.toMatchObject({ code: "INTERNAL" });
      expect(await readFile(target, "utf8")).toBe("original");
      expect(await readFile(path.join(root, temporaryName), "utf8")).toBe(
        "preserve existing content",
      );
    });
  });
  it("detects descriptor/path replacement and does not read a redirected parent", async () => {
    await withTempDir(async (dir) => {
      const root = await realpath(dir);
      await writeFile(path.join(root, "file"), "original");
      await writeFile(path.join(root, "replacement"), "replacement");
      await expect(
        readEditableFile(root, "file", () =>
          rename(path.join(root, "replacement"), path.join(root, "file")),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const sub = path.join(root, "sub");
      const outside = path.join(root, "outside");
      await mkdir(sub);
      await mkdir(outside);
      await writeFile(path.join(sub, "file"), "inside");
      await writeFile(path.join(outside, "file"), "outside");
      await expect(
        readEditableFile(root, "sub/file", async () => {
          await rename(sub, path.join(root, "old"));
          await symlink(outside, sub);
        }),
      ).rejects.toMatchObject({ code: "PATH_OUTSIDE_PROJECT" });
      expect(await readFile(path.join(outside, "file"), "utf8")).toBe("outside");
    });
  });

  it("preserves drafts on competing saves, file replacement and failed final fencing", async () => {
    await withTempDir(async (dir) => {
      const root = await realpath(dir);
      const file = path.join(root, "file");
      await writeFile(file, "original");
      const first = await readEditableFile(root, "file");
      let fenceChecks = 0;
      await expect(
        saveEditableFile(
          root,
          { path: "file", content: "editor draft", expectedVersion: first.version },
          {
            beforeCommit: () => writeFile(file, "external"),
          },
        ),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      expect(await readFile(file, "utf8")).toBe("external");
      const second = await readEditableFile(root, "file");
      await expect(
        saveEditableFile(
          root,
          { path: "file", content: "draft", expectedVersion: second.version },
          {
            beforeCommit: async () => {
              await writeFile(path.join(root, "same-content"), "external");
              await rename(path.join(root, "same-content"), file);
            },
          },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        saveEditableFile(
          root,
          { path: "file", content: "draft", expectedVersion: second.version },
          {
            beforeCommit: () => {},
            assertFence: () => {
              fenceChecks += 1;
              if (fenceChecks === 3)
                throw new FileManagerError("RESOURCE_LOCKED", "test fence expired");
            },
          },
        ),
      ).rejects.toMatchObject({ code: "RESOURCE_LOCKED" });
      expect(fenceChecks).toBe(3);
      expect(await readFile(file, "utf8")).toBe("external");
      expect((await readdir(root)).filter((name) => name.startsWith(".larness-save-"))).toEqual([]);
    });
  });

  it("preserves executable permissions and accepts exactly 512 KiB without truncation", async () => {
    await withTempDir(async (dir) => {
      const root = await realpath(dir);
      const file = path.join(root, "file");
      await writeFile(file, "x".repeat(512 * 1024));
      await chmod(file, 0o755);
      const original = await readEditableFile(root, "file");
      expect(original.content.length).toBe(512 * 1024);
      await saveEditableFile(
        root,
        { path: "file", content: "\ufeff中文\r\n", expectedVersion: original.version },
        { beforeCommit: () => {} },
      );
      expect(await readFile(file, "utf8")).toBe("\ufeff中文\r\n");
      if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o755);
    });
  });
});
