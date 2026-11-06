import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test("opens the independent service operations page from the left navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/pair");
  const panel = page.locator("[data-request-id]");
  await expect(panel).toHaveAttribute("data-stage", "waiting");
  const id = await panel.getAttribute("data-request-id");
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
        id ?? "",
        "allow_once",
      ],
      { encoding: "utf8" },
    ),
  );
  await page.getByLabel("配对码").fill(approved.code);
  await page.getByRole("button", { name: "兑换配对码" }).click();
  await expect(page.getByTestId("workspace-home")).toBeVisible();

  await page.getByRole("button", { name: "服务运维", exact: true }).click();
  await expect(page).toHaveURL(/\/service-ops$/);
  await expect(page.getByTestId("service-ops-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "服务运维", exact: true })).toBeVisible();
  await expect(page.getByText("正式服务 · 独立于当前聊天")).toBeVisible();
  await expect(
    page.getByText("还没有正式服务。通过 Agent 生成计划并发布后会出现在这里。"),
  ).toBeVisible();
  await expect(page.getByText("运行日志")).toHaveCount(0);
});
