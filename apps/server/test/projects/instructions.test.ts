import { realpathSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProjectRow } from "../../src/db/schema.js";
import {
  MAX_INSTRUCTION_CHARS,
  MAX_INSTRUCTION_FILE_BYTES,
  resolveProjectInstructions,
} from "../../src/modules/projects/instructions.js";
import { withTempDir } from "../helpers.js";

function projectRow(root: string, instructions = ""): ProjectRow {
  return {
    id: "prj_test",
    name: "test",
    rootPath: root,
    realPath: realpathSync(root),
    settingsJson: JSON.stringify({ instructions }),
    gitDetected: false,
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("project instruction resolution", () => {
  it("loads AGENTS.md, .larness/instructions.md and database settings in order", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      await mkdir(path.join(root, ".larness"), { recursive: true });
      await writeFile(path.join(root, "AGENTS.md"), "agents rules");
      await writeFile(path.join(root, ".larness", "instructions.md"), "larness rules");

      const resolved = resolveProjectInstructions(projectRow(root, "database rules"));

      expect(resolved.blocks).toHaveLength(3);
      expect(resolved.blocks[0]).toContain("Project instructions from AGENTS.md");
      expect(resolved.blocks[0]).toContain("project conventions");
      expect(resolved.blocks[0]).toContain("agents rules");
      expect(resolved.blocks[0]).not.toContain("untrusted;");
      expect(resolved.blocks[1]).toContain("Project instructions from .larness/instructions.md");
      expect(resolved.blocks[1]).toContain("larness rules");
      expect(resolved.blocks[2]).toContain("Project instructions from project settings");
      expect(resolved.blocks[2]).toContain("database rules");
      expect(resolved.sources.map((source) => source.source)).toEqual([
        "agents-md",
        "larness-instructions",
        "project-settings",
      ]);
      expect(resolved.totalChars).toBe(
        "agents rules".length + "larness rules".length + "database rules".length,
      );
    });
  });

  it("skips missing files without failing", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      await mkdir(root);

      const resolved = resolveProjectInstructions(projectRow(root));

      expect(resolved.blocks).toEqual([]);
      expect(resolved.warnings).toEqual([]);
      expect(resolved.sources.every((source) => source.chars === 0)).toBe(true);
      expect(resolved.sources.find((source) => source.source === "agents-md")?.present).toBe(false);
    });
  });

  it("truncates AGENTS.md first when the three sources exceed 20,000 characters", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      await mkdir(path.join(root, ".larness"), { recursive: true });
      await writeFile(path.join(root, "AGENTS.md"), "A".repeat(1_500));
      await writeFile(path.join(root, ".larness", "instructions.md"), "L".repeat(1_500));

      const resolved = resolveProjectInstructions(projectRow(root, "D".repeat(19_000)));
      const bySource = new Map(resolved.sources.map((source) => [source.source, source]));

      expect(bySource.get("project-settings")).toMatchObject({ chars: 19_000, truncated: false });
      expect(bySource.get("larness-instructions")).toMatchObject({ chars: 1_000, truncated: true });
      expect(bySource.get("agents-md")).toMatchObject({ chars: 0, truncated: true });
      expect(resolved.totalChars).toBe(MAX_INSTRUCTION_CHARS);
      expect(resolved.blocks.some((block) => block.includes("AGENTS.md"))).toBe(false);
      expect(resolved.warnings.join("\n")).toContain("truncated");
    });
  });

  it("does not read a symlink that escapes the project root", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      const outside = path.join(dir, "outside.md");
      await mkdir(root);
      await writeFile(outside, "outside secret");
      await symlink(outside, path.join(root, "AGENTS.md"));

      const resolved = resolveProjectInstructions(projectRow(root));
      const agents = resolved.sources.find((source) => source.source === "agents-md");

      expect(agents).toMatchObject({ present: false, chars: 0 });
      expect(agents?.warning).toContain("outside the project root");
      expect(resolved.blocks.join("\n")).not.toContain("outside secret");
    });
  });

  it("skips binary instruction files", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      await mkdir(root);
      await writeFile(path.join(root, "AGENTS.md"), Buffer.from([0x41, 0x00, 0x42]));

      const resolved = resolveProjectInstructions(projectRow(root));
      const agents = resolved.sources.find((source) => source.source === "agents-md");

      expect(agents).toMatchObject({ present: false, chars: 0 });
      expect(agents?.warning).toContain("binary");
    });
  });

  it("caps a single file read at 64 KiB", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      await mkdir(root);
      await writeFile(path.join(root, "AGENTS.md"), "x".repeat(MAX_INSTRUCTION_FILE_BYTES + 10));

      const resolved = resolveProjectInstructions(projectRow(root));
      const agents = resolved.sources.find((source) => source.source === "agents-md");

      expect(agents?.chars).toBe(MAX_INSTRUCTION_CHARS);
      expect(agents?.truncated).toBe(true);
      expect(agents?.warning).toContain("64 KiB");
    });
  });
});
