import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFakeProvider, createFileToolRegistry, type ProviderChunk } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { createCommandTool } from "../../src/modules/agent/commandTool.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { createProject } from "../../src/modules/projects/service.js";
import { createSession, updateSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
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

describe("agent Git through the command tool", () => {
  it("commits a patched file with shell Git and no dedicated Git tools", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
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
          { db: started.running.db, detectGit: async () => true },
          { rootPath: repo },
        );
        const session = await createSession(
          { db: started.running.db, dataDir: started.running.dataDir },
          { projectId: project.id },
        );
        updateSession(
          { db: started.running.db, dataDir: started.running.dataDir },
          { id: session.id, approvalPolicyId: "autonomous" },
        );
        const auth = (
          await started.running.app.inject({
            url: "/api/auth/session",
            headers: { cookie: started.cookie },
          })
        ).json() as { clientSessionId: string };
        const version = createHash("sha256").update("old\n").digest("hex");
        const turn = createTurn(
          { db: started.running.db },
          {
            sessionId: session.id,
            text: "patch and commit through shell",
            clientSessionId: auth.clientSessionId,
          },
        );
        const provider = createFakeProvider([
          toolStep("p1", "apply_patch", {
            path: "a.txt",
            expectedVersion: version,
            patch: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
          }),
          toolStep("g1", "run_command", {
            executable: "git",
            args: ["add", "a.txt"],
            cwd: ".",
          }),
          toolStep("g2", "run_command", {
            executable: "git",
            args: ["commit", "-m", "agent commit"],
            cwd: ".",
          }),
          textStep("done"),
        ]);
        const registry = createFileToolRegistry();
        registry.register(createCommandTool({}));
        const runner = new TurnRunner({
          db: started.running.db,
          registry,
          commands: started.running.commands,
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");
        expect(git(repo, "log", "-1", "--pretty=%s")).toBe("agent commit");
        expect(registry.has("git_commit")).toBe(false);
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
