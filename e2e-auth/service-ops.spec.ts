import { expect, test } from "@playwright/test";
import { execFileSync } from "./support";

test("opens the service operations dialog from the left navigation", async ({ page }) => {
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
  const dialog = page.getByTestId("service-ops-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "服务运维", exact: true })).toBeVisible();
  await expect(dialog.getByText(/独立于当前聊/)).toHaveCount(0);
  await expect(dialog.getByText("暂无正式服务", { exact: true })).toBeVisible();
  await expect(dialog.getByText("运行日志")).toHaveCount(0);
  await dialog.getByRole("button", { name: "关闭服务运维" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("workspace-home")).toBeVisible();
});
