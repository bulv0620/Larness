import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "@playwright/test";

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
  await expect(dialog.getByText("还没有定时任务")).toBeVisible();

  await dialog.getByRole("button", { name: "新建任务" }).first().click();
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
