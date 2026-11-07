import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runScript } from "../../src/modules/jobs/scriptRunner.js";
import { withTempDir } from "../helpers.js";

function input(
  dir: string,
  source: string,
  overrides: Partial<Parameters<typeof runScript>[0]> = {},
) {
  return {
    dataDir: dir,
    jobId: "job_test",
    runId: `run_${Math.random().toString(16).slice(2)}`,
    source,
    cwd: dir,
    timezone: "Asia/Shanghai",
    timeoutMs: 5_000,
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("script runner", () => {
  it("runs a node script in the project directory with a filtered environment", async () => {
    await withTempDir(async (dir) => {
      process.env.LARNESS_TEST_SECRET = "should-not-leak";
      try {
        const result = await runScript(
          input(
            dir,
            "console.log(JSON.stringify({ cwd: process.cwd(), tz: process.env.TZ, secret: process.env.LARNESS_TEST_SECRET, path: Boolean(process.env.PATH) }));",
          ),
        );

        expect(result.status).toBe("succeeded");
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.output)).toEqual({
          cwd: await realpath(dir),
          tz: "Asia/Shanghai",
          path: true,
        });
        expect(result.output).not.toContain("should-not-leak");
        expect(await readdir(path.join(dir, "jobs", "runs"))).toEqual([]);
      } finally {
        delete process.env.LARNESS_TEST_SECRET;
      }
    });
  });

  it("reports a non-zero exit code", async () => {
    await withTempDir(async (dir) => {
      const result = await runScript(input(dir, "process.exit(7)"));

      expect(result.status).toBe("failed");
      expect(result.exitCode).toBe(7);
      expect(result.errorCode).toBe("JOB_SCRIPT_FAILED");
      expect(result.errorMessage).toContain("7");
    });
  });

  it("kills a timed out script", async () => {
    await withTempDir(async (dir) => {
      const result = await runScript(
        input(dir, "setTimeout(() => {}, 60_000)", { timeoutMs: 200 }),
      );

      expect(result.status).toBe("timed_out");
      expect(result.errorCode).toBe("JOB_TIMEOUT");
    });
  });

  it("cancels a running script", async () => {
    await withTempDir(async (dir) => {
      const controller = new AbortController();
      const running = runScript(
        input(dir, "setInterval(() => {}, 1_000)", { signal: controller.signal }),
      );
      setTimeout(() => controller.abort(), 100);
      const result = await running;

      expect(result.status).toBe("cancelled");
      expect(result.errorCode).toBe("JOB_RUN_CANCELLED");
    });
  });

  it("keeps only the tail of oversized output", async () => {
    await withTempDir(async (dir) => {
      const result = await runScript(
        input(dir, 'process.stdout.write("a".repeat(100000) + "END")'),
      );

      expect(result.status).toBe("succeeded");
      expect(result.truncated).toBe(true);
      expect(result.output.length).toBeLessThanOrEqual(64 * 1024);
      expect(result.output.endsWith("END")).toBe(true);
    });
  });

  it("redacts known secret-shaped output", async () => {
    await withTempDir(async (dir) => {
      const result = await runScript(input(dir, 'console.log("api_key=sk-super-secret-value")'));

      expect(result.output).not.toContain("sk-super-secret-value");
    });
  });
});
