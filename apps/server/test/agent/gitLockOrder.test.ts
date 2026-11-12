import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFakeProvider, createFileToolRegistry, type ProviderChunk } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { listSessionEvents } from "../../src/modules/agent/events.js";
import { createGitTools } from "../../src/modules/agent/gitTool.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { GitManager } from "../../src/modules/git/manager.js";
import { createProject } from "../../src/modules/projects/service.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function toolStep(id: string, name: string, args: unknown): { chunks: ProviderChunk[] } {
  return {
    chunks: [
      { type: "tool-call", toolCall: { id, name, args } },
      { type: "finish", finishReason: "tool-calls" },
    ],
  };
}

function textStep(text: string): { chunks: ProviderChunk[] } {
  return {
    chunks: [
      { type: "text-delta", text },
      { type: "finish", finishReason: "stop" },
    ],
  };
}

describe("git tools after a write in the same turn", () => {
  it("can commit a file the agent patched earlier in the turn", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const repo = path.join(dir, "repo");
        await mkdir(repo);
        git(repo, "init", "-q", "-b", "main");
        git(repo, "config", "user.name", "Fixture");
        git(repo, "config", "user.email", "fixture@example.com");
        await writeFile(path.join(repo, "a.txt"), "old\n");
        git(repo, "add", "a.txt");
        git(repo, "commit", "-q", "-m", "initial");

        const project = await createProject(
          { db: opened.db, detectGit: async () => true },
          { rootPath: repo },
        );
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, { projectId: project.id });
        const version = createHash("sha256").update("old\n").digest("hex");
        const turn = createTurn(sessionOptions, {
          sessionId: session.id,
          text: "patch and commit",
        });
        const provider = createFakeProvider([
          toolStep("p1", "apply_patch", {
            path: "a.txt",
            expectedVersion: version,
            patch: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
          }),
          toolStep("g1", "git_add", { paths: ["a.txt"] }),
          toolStep("g2", "git_commit", { message: "agent commit" }),
          textStep("done"),
        ]);
        const registry = createFileToolRegistry();
        for (const tool of createGitTools()) registry.register(tool);
        const runner = new TurnRunner({
          db: opened.db,
          registry,
          git: new GitManager({ db: opened.db }),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const events = listSessionEvents(opened.db, session.id).items;
        const failed = events.filter((event) => event.type === "tool.failed");
        expect(failed.map((event) => event.payload)).toEqual([]);
      } finally {
        opened.close();
      }
    });
  });
});
