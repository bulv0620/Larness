import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { scheduledJobRuns, scheduledJobs } from "../../src/db/schema.js";
import { JobRuntime } from "../../src/modules/jobs/runtime.js";
import { JobService } from "../../src/modules/jobs/service.js";
import { withTempDir } from "../helpers.js";

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function fixture(dir: string) {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  const now = 1_000_000;
  const service = new JobService({ db: opened.db, now: () => now });
  const job = service.create({
    name: "tick",
    projectId: null,
    kind: "script",
    schedule: { type: "interval", seconds: 60, timezone: "Asia/Shanghai" },
    enabled: true,
    timeoutSeconds: 60,
    missedPolicy: "skip",
    script: { source: 'console.log("ok")' },
  });
  return { opened, service, job, now: () => now };
}

function success() {
  return {
    status: "succeeded" as const,
    exitCode: 0,
    output: "ok",
    truncated: false,
    errorCode: null,
    errorMessage: null,
  };
}

describe("job runtime", () => {
  it("claims a due job, advances the next run and records success", async () => {
    await withTempDir(async (dir) => {
      const { opened, job, now } = fixture(dir);
      const calls: unknown[] = [];
      const runtime = new JobRuntime({
        db: opened.db,
        dataDir: dir,
        now,
        tickMs: 60_000,
        scriptRunner: async (input) => {
          calls.push(input);
          return success();
        },
      });

      try {
        runtime.start();
        opened.db
          .update(scheduledJobs)
          .set({ nextRunAt: 999_000 })
          .where(eq(scheduledJobs.id, job.id))
          .run();

        await runtime.tick();
        await waitFor(() => calls.length === 1);

        const runs = opened.db.select().from(scheduledJobRuns).all();
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ status: "succeeded", trigger: "scheduled", exitCode: 0 });

        const stored = opened.db.select().from(scheduledJobs).all()[0];
        expect(stored?.lastStatus).toBe("succeeded");
        expect(stored?.nextRunAt).toBeGreaterThan(now());
        expect(calls[0]).toMatchObject({ timezone: "Asia/Shanghai", timeoutMs: 60_000 });
      } finally {
        await runtime.stop();
        opened.close();
      }
    });
  });

  it("records a skipped run when the previous run is still active", async () => {
    await withTempDir(async (dir) => {
      const { opened, job, now } = fixture(dir);
      const runtime = new JobRuntime({
        db: opened.db,
        dataDir: dir,
        now,
        tickMs: 60_000,
        scriptRunner: async () => {
          throw new Error("must not run");
        },
      });

      try {
        runtime.start();
        const active = {
          id: "run_active",
          jobId: job.id,
          trigger: "scheduled" as const,
          status: "running" as const,
          scheduledFor: 900_000,
          startedAt: 900_000,
          endedAt: null,
          durationMs: null,
          sessionId: null,
          turnId: null,
          exitCode: null,
          output: null,
          errorCode: null,
          errorMessage: null,
          createdAt: 900_000,
        };
        opened.db.insert(scheduledJobRuns).values(active).run();
        opened.db
          .update(scheduledJobs)
          .set({ nextRunAt: 999_000 })
          .where(eq(scheduledJobs.id, job.id))
          .run();

        await runtime.tick();

        const runs = opened.db.select().from(scheduledJobRuns).all();
        expect(runs).toHaveLength(2);
        expect(runs.find((run) => run.id !== "run_active")).toMatchObject({
          status: "skipped",
          errorCode: "JOB_OVERLAP",
        });
      } finally {
        await runtime.stop();
        opened.close();
      }
    });
  });

  it("marks leftover active runs interrupted on startup", async () => {
    await withTempDir(async (dir) => {
      const { opened, job, now } = fixture(dir);
      const runtime = new JobRuntime({ db: opened.db, dataDir: dir, now, tickMs: 60_000 });

      try {
        opened.db
          .insert(scheduledJobRuns)
          .values([
            {
              id: "run_running",
              jobId: job.id,
              trigger: "scheduled",
              status: "running",
              scheduledFor: 900_000,
              startedAt: 900_000,
              endedAt: null,
              durationMs: null,
              sessionId: null,
              turnId: null,
              exitCode: null,
              output: null,
              errorCode: null,
              errorMessage: null,
              createdAt: 900_000,
            },
            {
              id: "run_queued",
              jobId: job.id,
              trigger: "scheduled",
              status: "queued",
              scheduledFor: 900_000,
              startedAt: null,
              endedAt: null,
              durationMs: null,
              sessionId: null,
              turnId: null,
              exitCode: null,
              output: null,
              errorCode: null,
              errorMessage: null,
              createdAt: 900_000,
            },
          ])
          .run();

        runtime.start();

        const runs = opened.db.select().from(scheduledJobRuns).all();
        expect(runs.map((run) => run.status)).toEqual(["interrupted", "interrupted"]);
      } finally {
        await runtime.stop();
        opened.close();
      }
    });
  });

  it("creates one catch-up run for missed run_once jobs", async () => {
    await withTempDir(async (dir) => {
      const { opened, job, now } = fixture(dir);
      const calls: unknown[] = [];
      const runtime = new JobRuntime({
        db: opened.db,
        dataDir: dir,
        now,
        tickMs: 60_000,
        scriptRunner: async (input) => {
          calls.push(input);
          return success();
        },
      });

      try {
        opened.db
          .update(scheduledJobs)
          .set({ nextRunAt: 900_000, missedPolicy: "run_once" })
          .where(eq(scheduledJobs.id, job.id))
          .run();

        runtime.start();
        await waitFor(() => calls.length === 1);

        const runs = opened.db.select().from(scheduledJobRuns).all();
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ trigger: "catch_up", status: "succeeded" });

        const stored = opened.db.select().from(scheduledJobs).all()[0];
        expect(stored?.nextRunAt).toBeGreaterThan(now());
      } finally {
        await runtime.stop();
        opened.close();
      }
    });
  });
});
