import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { seedTask, TASKS } from "../../scripts/agent-benchmark/tasks.js";
import { withTempDir } from "../helpers.js";

describe("agent benchmark fixtures", () => {
  it.each(TASKS)("$id starts failing before the agent runs", async (task) => {
    await withTempDir(async (dir) => {
      await seedTask(task, dir);
      const result = spawnSync(task.verify[0] ?? "node", task.verify.slice(1), {
        cwd: dir,
        encoding: "utf8",
        timeout: 120_000,
      });
      expect(result.status, `${task.id}: ${result.stderr}`).not.toBe(0);
    });
  });
});
