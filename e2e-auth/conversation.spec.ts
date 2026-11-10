import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { execFileSync } from "./support";

test("M2-15 real plan updates, replay, compact composer, reading position and responsive layout", async ({
  page,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/pair");
  const pending = page.locator("[data-request-id]");
  await expect(pending).toHaveAttribute("data-stage", "waiting");
  const approved = JSON.parse(
    execFileSync(
      "pnpm",
      [
        "--silent",
        "--filter",
        "@larness/server",
        "exec",
        "tsx",
        "../../scripts/e2e-ipc.ts",
        "approve",
        (await pending.getAttribute("data-request-id")) ?? "",
        "allow_once",
      ],
      { encoding: "utf8" },
    ),
  );
  await page.getByLabel("配对码").fill(approved.code);
  await page.getByRole("button", { name: "兑换配对码" }).click();
  await expect(page.getByTestId("workspace-home")).toBeVisible();
  await page.getByRole("button", { name: "在 默认工作区 中新建会话" }).click();
  const input = page.getByLabel("对话输入");
  await input.fill("conversation plan");
  await page.getByRole("button", { name: "发送消息" }).click();
  // The fake provider can finish the two steps before a slower CI host renders
  // the intermediate 0/2 label; accepting any plan state keeps this E2E about
  // the durable plan/replay result rather than a scheduling race.
  await expect(page.getByRole("button", { name: /计划 · [012]\/2/ })).toBeVisible({
    timeout: 15_000,
  });
  await input.fill("保留的草稿");
  await input.press("Enter");
  await expect(input).toHaveValue("保留的草稿");
  await expect(page.getByText("计划验证结束。", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /计划 · 2\/2/ })).toHaveCount(1);
  await page.screenshot({ path: path.join(tmpdir(), "larness-m2-15-desktop.png") });
  await page.reload();
  const plan = page.getByRole("button", { name: /计划 · 2\/2/ });
  await expect(plan).toHaveCount(1);
  const log = page.getByRole("log", { name: "会话时间线" });
  await log.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  await plan.click();
  await expect(
    page.getByRole("list", { name: "检查项目" }).getByText("检查文件", { exact: false }),
  ).toBeVisible();
  await input.fill("list");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText("项目文件已列出。", { exact: true })).toHaveCount(1, {
    timeout: 20_000,
  });
  expect(await log.evaluate((element) => element.scrollTop)).toBeLessThan(100);
  await expect(page.getByRole("button", { name: "回到最新消息" })).toBeVisible();
  await page.getByRole("button", { name: "回到最新消息" }).click();
  await expect(page.getByText("项目文件已列出。", { exact: true })).toBeVisible();
  const dock = page.getByLabel("项目窗口", { exact: true });
  expect((await dock.boundingBox())?.height).toBeLessThanOrEqual(32);
  await expect(page.getByText(/正在执行，可先编辑|工作区上下文|Shift \+ Enter/)).toHaveCount(0);
  await page.getByRole("button", { name: "外观与主题" }).click();
  await page.getByRole("menuitemradio", { name: /深色/ }).click();
  await page.screenshot({ path: path.join(tmpdir(), "larness-m2-15-dark.png") });
  for (const width of [736, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const box = await input.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= width).toBeTruthy();
  }
  await page.screenshot({ path: path.join(tmpdir(), "larness-m2-15-mobile.png") });

  await page.setViewportSize({ width: 1440, height: 900 });
  await input.fill("conversation plan cancel");
  await page.getByRole("button", { name: "发送消息" }).click();
  const unfinished = page.getByRole("button", { name: /计划 · 0\/2/ });
  await unfinished.click();
  const steps = page.getByRole("list", { name: "检查项目", exact: true }).last();
  await expect(steps.locator(".animate-spin")).toBeVisible();
  await page.getByRole("button", { name: "停止执行" }).click();
  await expect(page.getByText("已停止当前执行。")).toBeVisible();
  await expect(steps.locator(".animate-spin")).toHaveCount(0);
  await expect(steps.getByText("未完成", { exact: true })).toBeVisible();
  await page.reload();
  await unfinished.click();
  await expect(steps.getByText("未完成", { exact: true })).toBeVisible();
  await expect(steps.locator(".animate-spin")).toHaveCount(0);
  expect(errors).toEqual([]);
});
