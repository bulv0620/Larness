import path from "node:path";
import { createFakeProvider, createFileToolRegistry } from "@larness/agent";
import { describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { AgentJobExecutor, incompleteTurnError } from "../../src/modules/jobs/agentRunner.js";
import { jobById } from "../../src/modules/jobs/repository.js";
import { JobService } from "../../src/modules/jobs/service.js";
import { getSessionById } from "../../src/modules/sessions/repository.js";
import { withTempDir } from "../helpers.js";

describe("agent job executor", () => {
  it("runs the job prompt as a real Turn in the dedicated session", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);
      try {
        const service = new JobService({ db: opened.db, dataDir: dir });
        const created = service.create({
          name: "Agent check",
          projectId: null,
          kind: "agent",
          schedule: { type: "cron", expression: "0 9 * * *", timezone: "Asia/Shanghai" },
          enabled: false,
          timeoutSeconds: 60,
          missedPolicy: "skip",
          agent: { prompt: "inspect the workspace", approvalPolicy: "readonly" },
        });
        const job = jobById(opened.db, created.id);
        if (job === null) {
          throw new Error("agent job was not created");
        }

        const provider = createFakeProvider([
          {
            chunks: [
              { type: "text-delta", text: "done" },
              { type: "finish", finishReason: "stop" },
            ],
          },
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          dataDir: dir,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });
        const executor = new AgentJobExecutor({
          db: opened.db,
          dataDir: dir,
          enqueue: (turnId: string) => {
            void runner.run(turnId);
          },
        });

        const result = await executor.run(
          job,
          {
            id: "run_test",
            jobId: job.id,
            trigger: "manual",
            status: "queued",
            scheduledFor: 1,
            startedAt: null,
            endedAt: null,
            durationMs: null,
            sessionId: null,
            turnId: null,
            exitCode: null,
            output: null,
            errorCode: null,
            errorMessage: null,
            createdAt: 1,
          },
          new AbortController().signal,
          5_000,
        );

        expect(result).toMatchObject({ status: "succeeded" });
        expect(result.sessionId).toBe(job.sessionId);
        expect(result.turnId).toMatch(/^trn_/);
        expect(provider.calls[0]?.messages[0]?.content).toContain("Turn approval policy: readonly");

        const sessionId = job.sessionId;
        if (sessionId === null) {
          throw new Error("agent job did not persist a session");
        }
        const session = getSessionById(opened.db, sessionId);
        expect(session?.origin).toBe("scheduled");
        expect(session?.approvalPolicyId).toBe("readonly");
      } finally {
        opened.close();
      }
    });
  });
});

async function pendingFixture(dir: string) {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  const service = new JobService({ db: opened.db, dataDir: dir });
  const created = service.create({
    name: "Agent pending",
    projectId: null,
    kind: "agent",
    schedule: { type: "cron", expression: "0 9 * * *", timezone: "Asia/Shanghai" },
    enabled: false,
    timeoutSeconds: 60,
    missedPolicy: "skip",
    agent: { prompt: "wait", approvalPolicy: "readonly" },
  });
  const job = jobById(opened.db, created.id);
  if (job === null) throw new Error("job missing");
  return { opened, job };
}

function queuedRun(jobId: string) {
  return {
    id: `run_${Math.random().toString(16).slice(2)}`,
    jobId,
    trigger: "manual" as const,
    status: "queued" as const,
    scheduledFor: 1,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    sessionId: null,
    turnId: null,
    exitCode: null,
    output: null,
    errorCode: null,
    errorMessage: null,
    createdAt: 1,
  };
}

describe("incomplete turn mapping", () => {
  it("does not count a budget or truncated turn as a successful run", () => {
    expect(incompleteTurnError(null)).toBeNull();
    expect(incompleteTurnError("normal")).toBeNull();

    expect(incompleteTurnError("budget")).toEqual({
      errorCode: "JOB_AGENT_INCOMPLETE",
      errorMessage: "Agent 任务因预算耗尽提前结束，请复核已完成的部分",
    });
    expect(incompleteTurnError("continued")?.errorCode).toBe("JOB_AGENT_INCOMPLETE");
    expect(incompleteTurnError("output_truncated")?.errorCode).toBe("JOB_AGENT_INCOMPLETE");
    expect(incompleteTurnError("provider_error")?.errorCode).toBe("JOB_AGENT_INCOMPLETE");
    expect(incompleteTurnError("cancelled")?.errorCode).toBe("JOB_AGENT_INCOMPLETE");
  });
});

describe("agent job cancellation", () => {
  it("times out and cancels the Turn when no runner settles it", async () => {
    await withTempDir(async (dir) => {
      const { opened, job } = await pendingFixture(dir);
      try {
        const cancelTurnRunner = vi.fn(() => true);
        const executor = new AgentJobExecutor({
          db: opened.db,
          dataDir: dir,
          enqueue: () => undefined,
          cancelTurnRunner,
          cancelGraceMs: 300,
        });
        const result = await executor.run(
          job,
          queuedRun(job.id),
          new AbortController().signal,
          100,
        );

        expect(result.status).toBe("timed_out");
        expect(result.errorCode).toBe("JOB_TIMEOUT");
        expect(cancelTurnRunner).toHaveBeenCalled();
      } finally {
        opened.close();
      }
    });
  });

  it("marks the run cancelled when the job signal aborts", async () => {
    await withTempDir(async (dir) => {
      const { opened, job } = await pendingFixture(dir);
      try {
        const controller = new AbortController();
        const executor = new AgentJobExecutor({
          db: opened.db,
          dataDir: dir,
          enqueue: () => undefined,
          cancelGraceMs: 300,
        });
        const running = executor.run(job, queuedRun(job.id), controller.signal, 5_000);
        setTimeout(() => controller.abort(), 100);
        const result = await running;

        expect(result.status).toBe("cancelled");
        expect(result.errorCode).toBe("JOB_RUN_CANCELLED");
      } finally {
        opened.close();
      }
    });
  });
});
