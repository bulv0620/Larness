import { expect, type Page, test } from "@playwright/test";
import { execFileSync } from "./support";

test.setTimeout(120_000);

async function pair(page: Page) {
  await page.goto("/pair");
  const panel = page.locator("[data-request-id]");
  await expect(panel).toHaveAttribute("data-stage", "waiting");
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
        (await panel.getAttribute("data-request-id")) ?? "",
        "allow_once",
      ],
      { encoding: "utf8" },
    ),
  );
  await page.getByLabel("配对码").fill(approved.code);
  await page.getByRole("button", { name: "兑换配对码" }).click();
  await expect(page.getByTestId("workspace-home")).toBeVisible();
}

test("creates a script job, runs it manually and keeps the history after refresh", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await pair(page);

  await page.getByRole("button", { name: "自动化任务" }).click();
  const dialog = page.getByTestId("jobs-dialog");
  await expect(dialog).toBeVisible();
  const emptyState = dialog.getByText("还没有定时任务");
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 590 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(emptyState).toBeVisible();
    await expect
      .poll(() =>
        emptyState.evaluate((title) => {
          const list = title.closest(".overflow-y-auto")?.getBoundingClientRect();
          const content = title.parentElement?.getBoundingClientRect();
          if (!list || !content) return Number.POSITIVE_INFINITY;
          return Math.max(
            Math.abs(list.left + list.width / 2 - (content.left + content.width / 2)),
            Math.abs(list.top + list.height / 2 - (content.top + content.height / 2)),
          );
        }),
      )
      .toBeLessThanOrEqual(2);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  await dialog.getByRole("button", { name: "新建任务" }).first().click();
  const scheduleType = dialog.getByRole("button", { name: "触发方式" });
  await expect(scheduleType).toBeVisible();
  await scheduleType.press("ArrowDown");
  const cron = page.getByRole("menuitemradio", { name: "Cron" });
  await expect(cron).toHaveAttribute("aria-checked", "true");
  await expect(cron).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: "固定间隔" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(scheduleType).toHaveText("固定间隔");
  await expect(scheduleType).toBeFocused();
  await expect(dialog.getByLabel("间隔（秒）")).toBeVisible();
  await scheduleType.click();
  await cron.click();
  await dialog.getByLabel("名称").fill("E2E 脚本");
  await dialog.getByRole("button", { name: "保存" }).click();

  await expect(dialog.getByRole("heading", { name: "E2E 脚本" })).toBeVisible();
  await dialog.getByRole("button", { name: "立即执行" }).click();
  await expect(dialog.getByText("成功").first()).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("hello", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("workspace-home")).toBeVisible();
  await page.getByRole("button", { name: "自动化任务" }).click();
  await expect(
    page.getByTestId("jobs-dialog").getByRole("button", { name: /E2E 脚本/ }),
  ).toBeVisible();
  await page
    .getByTestId("jobs-dialog")
    .getByRole("button", { name: /E2E 脚本/ })
    .click();
  await expect(page.getByTestId("jobs-dialog").getByText("hello", { exact: true })).toBeVisible();

  await page.getByTestId("jobs-dialog").getByRole("button", { name: "删除" }).click();
  await page.getByTestId("jobs-dialog").getByRole("button", { name: "确认删除" }).click();
  await expect(page.getByTestId("jobs-dialog").getByText("还没有定时任务")).toBeVisible();
});
