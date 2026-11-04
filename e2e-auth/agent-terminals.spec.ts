import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

async function cleanupProject(page: Page, root: string): Promise<boolean> {
  return page.evaluate(async (rootPath) => {
    try {
      const session = (await (await fetch("/api/auth/session")).json()) as {
        csrfToken?: string;
      };
      const csrf = session.csrfToken ?? "";
      const projects = (await (await fetch("/api/projects")).json()) as {
        projects?: { id: string; rootPath: string; realPath: string }[];
      };
      const project = projects.projects?.find(
        (item) =>
          item.realPath === rootPath ||
          item.rootPath === rootPath ||
          item.rootPath.endsWith(rootPath.split("/").at(-1) ?? ""),
      );
      if (!project) return true;
      const terminals = (await (await fetch("/api/terminals?limit=200")).json()) as {
        items?: { id: string; projectId: string | null }[];
      };
      for (const terminal of terminals.items ?? []) {
        if (terminal.projectId !== project.id) continue;
        await fetch(`/api/terminals/${terminal.id}/terminate`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-csrf-token": csrf },
          body: JSON.stringify({ confirmed: true }),
        });
      }
      const removed = await fetch(`/api/projects/${project.id}`, {
        method: "DELETE",
        headers: { "x-csrf-token": csrf },
      });
      return removed.ok;
    } catch {
      return false;
    }
  }, root);
}

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

test("M2-4c agent starts two approved project dev terminals and exposes non-focused tabs", async ({
  page,
}) => {
  test.setTimeout(90000);
  const root = mkdtempSync(path.join(tmpdir(), "larness-dev-e2e-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await pair(page);
    await page.getByRole("button", { name: "添加项目" }).click();
    await page.getByLabel("项目目录").fill(root);
    await page.getByRole("dialog").getByRole("button", { name: "添加项目" }).click();
    await page.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }).click();
    const composer = page.getByLabel("对话输入");
    await composer.fill("dev start");
    await page.getByRole("button", { name: "发送消息" }).click();

    await expect(page.getByRole("button", { name: "批准执行" })).toBeVisible();
    await expect(page.getByText(/项目目录不是沙箱/).first()).toBeVisible();
    await expect(page.getByText("启动项目终端 frontend").first()).toBeVisible();
    await page.getByRole("button", { name: "批准执行" }).click();
    await expect(page.getByRole("button", { name: "批准执行" })).toBeVisible();
    await page.getByRole("button", { name: "批准执行" }).click();
    await expect(page.getByText("开发终端已启动。", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "打开终端窗口" }).click();
    const terminalWindow = page.getByRole("dialog", { name: "frontend", exact: true });
    await expect(terminalWindow).toBeVisible();
    await expect(terminalWindow.getByRole("tab", { name: "frontend", exact: true })).toBeVisible();
    await expect(terminalWindow.getByRole("tab", { name: "backend", exact: true })).toBeVisible();
    await terminalWindow.getByRole("tab", { name: "frontend", exact: true }).click();
    await expect(terminalWindow.getByRole("log")).toContainText("FRONT_READY", {
      timeout: 15000,
    });
    await expect(terminalWindow).toContainText("只读观察");
    await expect(terminalWindow.getByRole("button", { name: "获取输入权" })).toBeVisible();
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-4c-agent-terminals.png") });
    expect(errors).toEqual([]);
  } finally {
    if (await cleanupProject(page, root)) rmSync(root, { recursive: true, force: true });
  }
});

test("M2-4d human takes over agent terminal control and the old generation is rejected", async ({
  page,
}) => {
  test.setTimeout(90000);
  const root = mkdtempSync(path.join(tmpdir(), "larness-control-e2e-"));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await pair(page);
    await page.getByRole("button", { name: "添加项目" }).click();
    await page.getByLabel("项目目录").fill(root);
    await page.getByRole("dialog").getByRole("button", { name: "添加项目" }).click();
    await page.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }).click();
    const composer = page.getByLabel("对话输入");
    await composer.fill("dev start");
    await page.getByRole("button", { name: "发送消息" }).click();
    await page.getByRole("button", { name: "批准执行" }).click();
    await expect(page.getByRole("button", { name: "批准执行" })).toBeVisible();
    await page.getByRole("button", { name: "批准执行" }).click();
    await expect(page.getByText("开发终端已启动。", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "打开终端窗口" }).click();
    const terminalWindow = page.getByRole("dialog", { name: "frontend", exact: true });
    await expect(terminalWindow).toBeVisible();
    await composer.fill("ai control");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(terminalWindow).toContainText("AI 控制中", { timeout: 15000 });
    await terminalWindow.getByRole("button", { name: "接管控制" }).click();
    await expect(terminalWindow).toContainText("你正在控制");
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-4d-takeover.png") });

    await terminalWindow.getByRole("button", { name: "隐藏窗口" }).click();
    await expect(page.getByRole("button", { name: "批准执行" })).toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "批准执行" }).click();
    await expect(page.getByText("done", { exact: true })).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: /执行了 2 个工具 acquire_terminal_control/ }).click();
    await page.getByRole("button", { name: /send_terminal_input 向终端/ }).click();
    await expect(page.getByText(/TERMINAL_LEASE_REQUIRED/).first()).toBeVisible({
      timeout: 15000,
    });
    expect(errors).toEqual([]);
  } finally {
    if (await cleanupProject(page, root)) rmSync(root, { recursive: true, force: true });
  }
});
