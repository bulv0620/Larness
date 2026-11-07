import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { projects } from "../../src/db/schema.js";
import { JobService } from "../../src/modules/jobs/service.js";
import { withTempDir } from "../helpers.js";

function createService(dir: string) {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  let now = 1_000_000;
  const service = new JobService({ db: opened.db, dataDir: dir, now: () => now });
  return {
    opened,
    service,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const base = {
  name: "每日检查",
  projectId: null,
  enabled: true,
  timeoutSeconds: 600,
  missedPolicy: "skip" as const,
  schedule: { type: "cron" as const, expression: "0 9 * * *", timezone: "Asia/Shanghai" },
  script: { source: 'console.log("ok")' },
};

describe("job service", () => {
  it("creates, lists and reads a script job without leaking its source in the list", async () => {
    await withTempDir(async (dir) => {
      const { opened, service } = createService(dir);
      try {
        const job = service.create({ ...base, kind: "script" });
        expect(job.id).toMatch(/^job_/);
        expect(job.nextRunAt).not.toBeNull();
        expect(job.script?.source).toBe('console.log("ok")');

        const list = service.list();
        expect(list.items).toHaveLength(1);
        expect("script" in list.items[0]).toBe(false);
        expect("agent" in list.items[0]).toBe(false);

        expect(service.get(job.id).script?.source).toBe('console.log("ok")');
        expect(service.summary()).toEqual({
          total: 1,
          enabled: 1,
          running: 0,
          failedLast24h: 0,
        });
      } finally {
        opened.close();
      }
    });
  });

  it("normalizes the default project and validates projects", async () => {
    await withTempDir(async (dir) => {
      const { opened, service } = createService(dir);
      try {
        const job = service.create({ ...base, kind: "script", projectId: "prj_default" });
        expect(job.projectId).toBeNull();

        expect(() => service.create({ ...base, kind: "script", projectId: "prj_missing" })).toThrow(
          /Project not found/,
        );
      } finally {
        opened.close();
      }
    });
  });

  it("updates schedule, enablement and source", async () => {
    await withTempDir(async (dir) => {
      const { opened, service } = createService(dir);
      try {
        const job = service.create({ ...base, kind: "script" });
        const disabled = service.update(job.id, { enabled: false });
        expect(disabled.enabled).toBe(false);
        expect(disabled.nextRunAt).toBeNull();

        const updated = service.update(job.id, {
          enabled: true,
          name: "改名",
          schedule: { type: "interval", seconds: 120, timezone: "UTC" },
        });
        expect(updated.name).toBe("改名");
        expect(updated.schedule).toEqual({ type: "interval", seconds: 120, timezone: "UTC" });
        expect(updated.nextRunAt).toBe(1_120_000);
      } finally {
        opened.close();
      }
    });
  });

  it("runs manually, rejects an active job and cancels the queued run", async () => {
    await withTempDir(async (dir) => {
      const { opened, service } = createService(dir);
      try {
        const job = service.create({ ...base, kind: "script" });
        const run = service.runNow(job.id);
        expect(run.status).toBe("queued");
        expect(run.trigger).toBe("manual");

        expect(() => service.runNow(job.id)).toThrow(/already running/);

        const cancelled = service.cancelRun(run.id);
        expect(cancelled.status).toBe("cancelled");
        expect(cancelled.errorCode).toBe("JOB_RUN_CANCELLED");

        expect(() => service.runNow(job.id)).toThrow(/rate limited/);
      } finally {
        opened.close();
      }
    });
  });

  it("lists runs with a cursor and archives jobs", async () => {
    await withTempDir(async (dir) => {
      const { opened, service, advance } = createService(dir);
      try {
        const job = service.create({ ...base, kind: "script" });
        const first = service.runNow(job.id);
        service.cancelRun(first.id);
        advance(10_001);
        const second = service.runNow(job.id);
        service.cancelRun(second.id);

        const page = service.listRuns(job.id, { limit: 1 });
        expect(page.items).toHaveLength(1);
        expect(page.nextCursor).not.toBeNull();

        service.archive(job.id);
        expect(() => service.get(job.id)).toThrow(/not found/);
        expect(() => service.listRuns(job.id)).toThrow(/not found/);
      } finally {
        opened.close();
      }
    });
  });

  it("creates an Agent job with a hidden scheduled session", async () => {
    await withTempDir(async (dir) => {
      const { opened, service } = createService(dir);
      try {
        const job = service.create({
          ...base,
          kind: "agent",
          agent: { prompt: "check", approvalPolicy: "readonly" },
        });

        expect(job.kind).toBe("agent");
        expect(job.agent).toMatchObject({ prompt: "check", approvalPolicy: "readonly" });
        expect(job.agent?.sessionId).toMatch(/^ses_/);

        const session = opened.sqlite
          .prepare("SELECT origin, approval_policy_id, title FROM sessions WHERE id = ?")
          .get(job.agent?.sessionId) as {
          origin: string;
          approval_policy_id: string;
          title: string;
        };
        expect(session).toEqual({
          origin: "scheduled",
          approval_policy_id: "readonly",
          title: "自动化 · 每日检查",
        });

        const updated = service.update(job.id, {
          name: "改名任务",
          agent: { prompt: "check again", approvalPolicy: "autonomous" },
        });
        expect(updated.agent).toMatchObject({
          prompt: "check again",
          approvalPolicy: "autonomous",
        });

        const after = opened.sqlite
          .prepare("SELECT approval_policy_id, title FROM sessions WHERE id = ?")
          .get(job.agent?.sessionId) as { approval_policy_id: string; title: string };
        expect(after).toEqual({
          approval_policy_id: "autonomous",
          title: "自动化 · 改名任务",
        });

        service.archive(job.id);
        const archived = opened.sqlite
          .prepare("SELECT status FROM sessions WHERE id = ?")
          .get(job.agent?.sessionId) as { status: string };
        expect(archived.status).toBe("archived");
      } finally {
        opened.close();
      }
    });
  });

  it("rejects invalid schedules and unknown projects", async () => {
    await withTempDir(async (dir) => {
      const { opened, service } = createService(dir);
      try {
        expect(() =>
          service.create({
            ...base,
            kind: "script",
            schedule: { type: "cron", expression: "bad", timezone: "UTC" },
          }),
        ).toThrow(/Invalid cron/);

        expect(() =>
          service.create({
            ...base,
            kind: "script",
            schedule: { type: "cron", expression: "0 9 * * *", timezone: "Nope/Nope" },
          }),
        ).toThrow(/Invalid timezone/);
      } finally {
        opened.close();
      }
    });
  });

  it("keeps a real project reference", async () => {
    await withTempDir(async (dir) => {
      const { opened, service } = createService(dir);
      try {
        opened.db
          .insert(projects)
          .values({
            id: "prj_real",
            name: "Real",
            rootPath: dir,
            realPath: dir,
            createdAt: 1,
            updatedAt: 1,
          })
          .run();

        const job = service.create({ ...base, kind: "script", projectId: "prj_real" });
        expect(job.projectId).toBe("prj_real");
      } finally {
        opened.close();
      }
    });
  });
});
