import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFakeProvider, createFileToolRegistry, type ProviderChunk } from "@larness/agent";
import { expect, it } from "vitest";
import { decideApproval } from "../../src/modules/agent/approvalService.js";
import { createGitTools } from "../../src/modules/agent/gitTool.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { createProject } from "../../src/modules/projects/service.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer } from "../support/server.js";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
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
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out");
}

it("runs Git read and L1 actions, then approves an L2 push through the Turn tool chain", async () => {
  await withTempDir(async (dir) => {
    const repo = path.join(dir, "repo");
    const remote = path.join(dir, "remote.git");
    await mkdir(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.name", "Fixture");
    git(repo, "config", "user.email", "fixture@example.com");
    await writeFile(path.join(repo, "a.txt"), "one\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-q", "-m", "initial");
    git(dir, "init", "-q", "--bare", remote);
    git(repo, "remote", "add", "origin", remote);
    git(repo, "push", "-q", "-u", "origin", "main");

    const started = await startAuthorizedServer(path.join(dir, "data"));
    const project = await createProject({ db: started.running.db }, { rootPath: repo });
    const session = await createSession(
      { db: started.running.db, dataDir: started.running.dataDir },
      { projectId: project.id },
    );
    const client = (
      await started.running.app.inject({
        url: "/api/auth/session",
        headers: { cookie: started.cookie },
      })
    ).json() as { clientSessionId: string };
    const turn = createTurn(
      { db: started.running.db },
      { sessionId: session.id, text: "git work", clientSessionId: client.clientSessionId },
    );
    await writeFile(path.join(repo, "a.txt"), "two\n");
    const provider = createFakeProvider([
      toolStep("status", "git_status", {}),
      toolStep("add", "git_add", { paths: ["a.txt"] }),
      toolStep("commit", "git_commit", { message: "agent commit" }),
      toolStep("push", "git_push", {}),
      textStep("git done"),
    ]);
    const registry = createFileToolRegistry();
    for (const tool of createGitTools()) registry.register(tool);
    const runner = new TurnRunner({
      db: started.running.db,
      registry,
      git: started.running.git,
      resolveProvider: () => ({ adapter: provider, model: "fake" }),
      approvalPollMs: 5,
    });
    try {
      const running = runner.run(turn.turnId);
      await until(() =>
        Boolean(
          started.running.sqlite.prepare("SELECT id FROM approvals WHERE status = 'pending'").get(),
        ),
      );
      const approval = started.running.sqlite
        .prepare("SELECT id, scope_json FROM approvals WHERE status = 'pending'")
        .get() as { id: string; scope_json: string };
      expect(approval.scope_json).toContain("git_push");
      decideApproval(
        { db: started.running.db },
        { id: approval.id, decision: "approve", decidedBy: "test-operator" },
      );
      expect((await running).status).toBe("COMPLETED");
      expect(git(repo, "log", "-1", "--format=%s")).toBe("agent commit");
      expect(git(remote, "rev-parse", "main")).toBe(git(repo, "rev-parse", "HEAD"));
      const status = await started.running.git.status(project.id);
      expect(status.staged).toEqual([]);
      expect(status.unstaged).toEqual([]);
    } finally {
      await started.running.shutdown("test");
    }
  });
});
