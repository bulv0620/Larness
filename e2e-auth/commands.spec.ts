import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("M2 command approval runs real bytes, streams redacted output, survives refresh and cancels explicitly", async ({
  page,
}) => {
  test.setTimeout(90000);
  const root = mkdtempSync(path.join(tmpdir(), "larness-command-e2e-"));
  const errors: string[] = [];
  let terminalCreates = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/terminals")
      terminalCreates++;
  });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
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
    await page.getByRole("button", { name: "添加项目" }).click();
    await page.getByLabel("项目目录").fill(root);
    await page.getByRole("dialog").getByRole("button", { name: "添加项目" }).click();
    await page.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }).click();
    const composer = page.getByLabel("对话输入");
    await composer.fill("command finite");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("button", { name: "批准执行" })).toBeVisible();
    await expect(page.getByText(/项目目录不是沙箱/).first()).toBeVisible();
    expect(() => readFileSync(path.join(root, "command-effect"))).toThrow();
    await page.getByRole("button", { name: "批准执行" }).click();
    const card = page.getByRole("region", { name: "命令执行" }).first();
    await expect(card.getByRole("log", { name: "命令输出" })).toContainText("public start");
    await expect(card.getByRole("status")).toHaveText("执行中");
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-3b-running.png") });
    await page.reload();
    const restored = page.getByRole("region", { name: "命令执行" }).first();
    await expect(restored.getByRole("log", { name: "命令输出" })).toContainText("public start");
    await expect(restored.getByRole("status")).toHaveText("执行失败", { timeout: 15000 });
    await expect(restored).toContainText("退出码 7");
    await expect(restored).toContainText("public finish");
    await expect(restored).not.toContainText("fixture-command-secret");
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-3b-result.png") });
    expect(readFileSync(path.join(root, "command-effect"), "utf8")).toBe("once");
    await expect(page.getByText("命令结果已读取。", { exact: true })).toBeVisible();
    await composer.fill("command cancel");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByRole("button", { name: "批准执行" }).click();
    const active = page.getByRole("region", { name: "命令执行" }).last();
    await expect(active.getByRole("log", { name: "命令输出" })).toContainText("running");
    await expect
      .poll(() => {
        try {
          return Number(readFileSync(path.join(root, "ticks"), "utf8"));
        } catch {
          return 0;
        }
      })
      .toBeGreaterThan(0);
    await active.getByRole("button", { name: "取消命令" }).click();
    await expect(active.getByRole("status")).toHaveText("已取消");
    const stopped = readFileSync(path.join(root, "ticks"), "utf8");
    await page.waitForTimeout(350);
    expect(readFileSync(path.join(root, "ticks"), "utf8")).toBe(stopped);
    expect(terminalCreates).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
