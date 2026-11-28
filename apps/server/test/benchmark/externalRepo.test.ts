import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyExternalRepo,
  createExternalTask,
  splitCommand,
} from "../../scripts/agent-benchmark/externalRepo.js";
import { withTempDir } from "../helpers.js";

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe("external benchmark repo", () => {
  it("splits a simple verify command and rejects an empty one", () => {
    expect(splitCommand("  pnpm --filter @larness/agent test  ")).toEqual([
      "pnpm",
      "--filter",
      "@larness/agent",
      "test",
    ]);
    expect(() => splitCommand("   ")).toThrow(/verify command/);
  });

  it("builds a task with no fixture files and a safe id", async () => {
    await withTempDir(async (dir) => {
      const repo = path.join(dir, "My Repo");
      await mkdir(repo);

      const task = createExternalTask({
        repo,
        prompt: "Fix the bug.",
        verify: "node --test",
      });

      expect(task).toMatchObject({
        id: "my-repo",
        title: "External repo: My Repo",
        prompts: ["Fix the bug."],
        files: [],
        verify: ["node", "--test"],
      });
      expect(task.repo).toBe(path.resolve(repo));
    });
  });

  it("requires repo, prompt and verify", () => {
    expect(() => createExternalTask({ repo: "", prompt: "x", verify: "node --test" })).toThrow(
      /repo/,
    );
    expect(() => createExternalTask({ repo: "/tmp", prompt: " ", verify: "node --test" })).toThrow(
      /prompt/,
    );
    expect(() => createExternalTask({ repo: "/tmp", prompt: "x", verify: " " })).toThrow(/verify/);
  });

  it("copies the working tree but excludes metadata and top-level tmp", async () => {
    await withTempDir(async (dir) => {
      const source = path.join(dir, "source");
      const target = path.join(dir, "target");
      await mkdir(path.join(source, ".git"), { recursive: true });
      await mkdir(path.join(source, ".larness"), { recursive: true });
      await mkdir(path.join(source, "tmp"), { recursive: true });
      await mkdir(path.join(source, "src", "tmp"), { recursive: true });
      await writeFile(path.join(source, ".git", "config"), "secret", "utf8");
      await writeFile(path.join(source, ".larness", "instructions.md"), "secret", "utf8");
      await writeFile(path.join(source, "tmp", "out.txt"), "discard", "utf8");
      await writeFile(path.join(source, "src", "tmp", "keep.txt"), "keep", "utf8");
      await writeFile(path.join(source, "package.json"), "{}", "utf8");

      await copyExternalRepo(source, target);

      expect(await exists(path.join(target, ".git"))).toBe(false);
      expect(await exists(path.join(target, ".larness"))).toBe(false);
      expect(await exists(path.join(target, "tmp"))).toBe(false);
      expect(await readFile(path.join(target, "src", "tmp", "keep.txt"), "utf8")).toBe("keep");
      expect(await readFile(path.join(target, "package.json"), "utf8")).toBe("{}");
    });
  });
});
