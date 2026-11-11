import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  artifactDirectory,
  commitArtifact,
  stageArtifact,
} from "../../src/modules/service-ops/storage.js";
import { withTempDir } from "../helpers.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, rename: vi.fn(original.rename) };
});

afterEach(() => {
  vi.mocked(rename).mockReset();
});

async function stagedArtifact(dir: string) {
  const outputDirectory = path.join(dir, "output");
  await mkdir(outputDirectory);
  await writeFile(path.join(outputDirectory, "main.js"), "console.log('ok');");
  return stageArtifact({
    dataDir: dir,
    outputDirectory,
    targetId: "target_test",
    artifactId: "artifact_test",
    buildId: "build_test",
  });
}

const permissionError = Object.assign(new Error("Directory rename denied"), { code: "EPERM" });

it.skipIf(process.platform !== "win32")(
  "commits an artifact after transient Windows EPERM",
  async () => {
    await withTempDir(async (dir) => {
      const staged = await stagedArtifact(dir);
      vi.mocked(rename).mockRejectedValueOnce(permissionError);

      const committed = await commitArtifact(dir, staged);

      expect(rename).toHaveBeenCalledTimes(2);
      const payload = path.join(artifactDirectory(dir, committed), "payload", "main.js");
      expect(await readFile(payload, "utf8")).toBe("console.log('ok');");
      await expect(stat(staged.directory)).rejects.toMatchObject({ code: "ENOENT" });
    });
  },
);

it("keeps the staged directory when renaming fails permanently", async () => {
  await withTempDir(async (dir) => {
    const staged = await stagedArtifact(dir);
    vi.mocked(rename).mockRejectedValue(permissionError);

    await expect(commitArtifact(dir, staged)).rejects.toBe(permissionError);

    expect(rename).toHaveBeenCalledTimes(process.platform === "win32" ? 5 : 1);
    expect((await stat(staged.directory)).isDirectory()).toBe(true);
  });
});

it("does not retry an unrelated rename error", async () => {
  await withTempDir(async (dir) => {
    const staged = await stagedArtifact(dir);
    const missing = Object.assign(new Error("Directory missing"), { code: "ENOENT" });
    vi.mocked(rename).mockRejectedValueOnce(missing);

    await expect(commitArtifact(dir, staged)).rejects.toBe(missing);

    expect(rename).toHaveBeenCalledTimes(1);
  });
});
