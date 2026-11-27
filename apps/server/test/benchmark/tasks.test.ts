import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { seedTask, TASKS, taskById } from "../../scripts/agent-benchmark/tasks.js";
import { withTempDir } from "../helpers.js";

const FIXED_DISCOUNT = [
  "export function applyDiscount(amount, rate) {",
  "  if (rate <= 0) return amount;",
  "  return amount * (1 - rate);",
  "}",
  "",
].join("\n");

const FIXED_QUOTE = [
  'import { subtotal } from "../pricing/subtotal.js";',
  'import { applyDiscount } from "../pricing/discount.js";',
  'import { shippingFor } from "./shipping.js";',
  "",
  'export function quote({ items, discountRate = 0, country = "US" }) {',
  "  const itemsTotal = subtotal(items);",
  "  const shipping = shippingFor(country);",
  "  return applyDiscount(itemsTotal, discountRate) + shipping;",
  "}",
  "",
].join("\n");

function verifyTask(taskDirectory: string, verify: string[]) {
  return spawnSync(verify[0] ?? "node", verify.slice(1), {
    cwd: taskDirectory,
    encoding: "utf8",
    timeout: 120_000,
  });
}

describe("agent benchmark fixtures", () => {
  it.each(TASKS)("$id starts failing before the agent runs", async (task) => {
    await withTempDir(async (dir) => {
      await seedTask(task, dir);
      const result = verifyTask(dir, task.verify);
      expect(result.status, `${task.id}: ${result.stderr}`).not.toBe(0);
    });
  });

  it("ships a checkout fixture with at least 30 files", () => {
    const task = taskById("checkout-discount");
    expect(task).toBeDefined();
    expect(task?.files.length ?? 0).toBeGreaterThanOrEqual(30);
  });

  it("checkout-discount passes after the intended two-file fix", async () => {
    const task = taskById("checkout-discount");
    expect(task).toBeDefined();
    if (task === undefined) throw new Error("checkout-discount fixture missing");

    await withTempDir(async (dir) => {
      await seedTask(task, dir);
      await writeFile(path.join(dir, "src/pricing/discount.js"), FIXED_DISCOUNT, "utf8");
      await writeFile(path.join(dir, "src/checkout/quote.js"), FIXED_QUOTE, "utf8");
      const result = verifyTask(dir, task.verify);
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    });
  });

  it.each([
    ["discount only", "src/pricing/discount.js", FIXED_DISCOUNT],
    ["quote only", "src/checkout/quote.js", FIXED_QUOTE],
  ])("checkout-discount still fails with the %s fix", async (_name, file, content) => {
    const task = taskById("checkout-discount");
    expect(task).toBeDefined();
    if (task === undefined) throw new Error("checkout-discount fixture missing");

    await withTempDir(async (dir) => {
      await seedTask(task, dir);
      await writeFile(path.join(dir, file), content, "utf8");
      const result = verifyTask(dir, task.verify);
      expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0);
    });
  });
});
