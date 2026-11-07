import { describe, expect, it } from "vitest";
import { createSessionRow } from "../../src/modules/sessions/repository.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

async function waitForStatus(
  started: Awaited<ReturnType<typeof startAuthorizedServer>>,
  runId: string,
  statuses: string[],
): Promise<{ status: string; exitCode: number | null; output: string | null }> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const response = await started.running.app.inject({
      method: "GET",
      url: `/api/job-runs/${runId}`,
      headers: { cookie: started.cookie },
    });
    const run = response.json() as {
      status: string;
      exitCode: number | null;
      output: string | null;
    };
    if (statuses.includes(run.status)) {
      return run;
    }
    if (Date.now() > deadline) {
      throw new Error(`run did not reach ${statuses.join("/")}; last ${run.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const schedule = { type: "cron", expression: "0 9 1 1 *", timezone: "Asia/Shanghai" };

describe("jobs API", () => {
  it("creates, runs, lists and deletes a script job with auth and CSRF", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir, {
        env: { LARNESS_SCHEDULER_ENABLED: "0" },
      });
      const auth = { cookie: started.cookie, origin: started.origin, "x-csrf-token": started.csrf };

      try {
        const unauthenticated = await started.running.app.inject({
          method: "GET",
          url: "/api/jobs",
        });
        expect(unauthenticated.statusCode).toBe(401);

        const noCsrf = await started.running.app.inject({
          method: "POST",
          url: "/api/jobs",
          headers: { cookie: started.cookie, origin: started.origin },
          payload: {
            name: "no csrf",
            projectId: null,
            kind: "script",
            schedule,
            enabled: true,
            timeoutSeconds: 60,
            missedPolicy: "skip",
            script: { source: 'console.log("ok")' },
          },
        });
        expect(noCsrf.statusCode).toBe(403);

        const created = await started.running.app.inject({
          method: "POST",
          url: "/api/jobs",
          headers: auth,
          payload: {
            name: "检查",
            projectId: null,
            kind: "script",
            schedule,
            enabled: true,
            timeoutSeconds: 60,
            missedPolicy: "skip",
            script: { source: 'console.log("ok")' },
          },
        });
        expect(created.statusCode).toBe(201);
        const job = created.json() as { id: string; name: string; nextRunAt: number };
        expect(job.id).toMatch(/^job_/);
        expect(job.nextRunAt).toBeGreaterThan(Date.now());

        const list = await started.running.app.inject({
          method: "GET",
          url: "/api/jobs",
          headers: { cookie: started.cookie },
        });
        expect(list.statusCode).toBe(200);
        expect(list.body).not.toContain("console.log");
        expect(list.json()).toMatchObject({ items: [{ id: job.id, name: "检查" }] });

        const detail = await started.running.app.inject({
          method: "GET",
          url: `/api/jobs/${job.id}`,
          headers: { cookie: started.cookie },
        });
        expect(detail.json()).toMatchObject({ script: { source: 'console.log("ok")' } });

        const run = await started.running.app.inject({
          method: "POST",
          url: `/api/jobs/${job.id}/run`,
          headers: auth,
        });
        expect(run.statusCode).toBe(202);
        const runId = (run.json() as { id: string }).id;
        const finished = await waitForStatus(started, runId, ["succeeded", "failed"]);
        expect(finished.status).toBe("succeeded");
        expect(finished.exitCode).toBe(0);

        const limited = await started.running.app.inject({
          method: "POST",
          url: `/api/jobs/${job.id}/run`,
          headers: auth,
        });
        expect(limited.statusCode).toBe(429);
        expect(limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });

        const summary = await started.running.app.inject({
          method: "GET",
          url: "/api/jobs/summary",
          headers: { cookie: started.cookie },
        });
        expect(summary.json()).toMatchObject({ total: 1, enabled: 1, running: 0 });

        const runs = await started.running.app.inject({
          method: "GET",
          url: `/api/jobs/${job.id}/runs?limit=10`,
          headers: { cookie: started.cookie },
        });
        expect(runs.json()).toMatchObject({ items: [{ id: runId, status: "succeeded" }] });

        const deleted = await started.running.app.inject({
          method: "DELETE",
          url: `/api/jobs/${job.id}`,
          headers: auth,
        });
        expect(deleted.statusCode).toBe(204);

        const missing = await started.running.app.inject({
          method: "GET",
          url: `/api/jobs/${job.id}`,
          headers: { cookie: started.cookie },
        });
        expect(missing.statusCode).toBe(404);

        createSessionRow(started.running.db, {
          id: "ses_scheduled",
          projectId: null,
          workspacePath: dir,
          title: "自动化 · 检查",
          modelProfileId: null,
          approvalPolicyId: "readonly",
          origin: "scheduled",
          now: Date.now(),
        });
        const sessions = await started.running.app.inject({
          method: "GET",
          url: "/api/sessions",
          headers: { cookie: started.cookie },
        });
        expect(sessions.json()).not.toContain("ses_scheduled");
        const scheduledSession = await started.running.app.inject({
          method: "GET",
          url: "/api/sessions/ses_scheduled",
          headers: { cookie: started.cookie },
        });
        expect(scheduledSession.statusCode).toBe(200);

        const audit = started.running.sqlite
          .prepare("SELECT action FROM audit_logs WHERE resource_id = ?")
          .all(job.id) as { action: string }[];
        expect(audit.map((row) => row.action)).toContain("job.created");
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("cancels a running script and rejects agent jobs", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(dir, {
        env: { LARNESS_SCHEDULER_ENABLED: "0" },
      });
      const auth = { cookie: started.cookie, origin: started.origin, "x-csrf-token": started.csrf };

      try {
        const created = await started.running.app.inject({
          method: "POST",
          url: "/api/jobs",
          headers: auth,
          payload: {
            name: "长任务",
            projectId: null,
            kind: "script",
            schedule,
            enabled: true,
            timeoutSeconds: 60,
            missedPolicy: "skip",
            script: { source: "setInterval(() => {}, 1000)" },
          },
        });
        const jobId = (created.json() as { id: string }).id;

        const run = await started.running.app.inject({
          method: "POST",
          url: `/api/jobs/${jobId}/run`,
          headers: auth,
        });
        const runId = (run.json() as { id: string }).id;
        await waitForStatus(started, runId, ["running"]);

        const cancelled = await started.running.app.inject({
          method: "POST",
          url: `/api/job-runs/${runId}/cancel`,
          headers: auth,
        });
        expect(cancelled.statusCode).toBe(200);
        const finished = await waitForStatus(started, runId, ["cancelled"]);
        expect(finished.status).toBe("cancelled");

        const agent = await started.running.app.inject({
          method: "POST",
          url: "/api/jobs",
          headers: auth,
          payload: {
            name: "Agent",
            projectId: null,
            kind: "agent",
            schedule,
            enabled: true,
            timeoutSeconds: 60,
            missedPolicy: "skip",
            agent: { prompt: "check", approvalPolicy: "readonly" },
          },
        });
        expect(agent.statusCode).toBe(201);
        expect(agent.json()).toMatchObject({
          kind: "agent",
          agent: { prompt: "check", approvalPolicy: "readonly" },
        });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
