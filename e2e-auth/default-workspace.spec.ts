import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { execFileSync } from "./support";

test("M2-10 default workspace shares files, sessions and terminal views across project switching and refresh", async ({
  page,
}) => {
  test.setTimeout(90000);
  const root = mkdtempSync(path.join(tmpdir(), "larness-default-project-"));
  let terminalId = "";
  let projectId = "";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
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
    const defaultProject = page.locator('[data-project-id="prj_default"]');
    await expect(defaultProject).toBeVisible();
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-13-default-project.png") });
    await expect(
      defaultProject.getByRole("button", { name: "在 默认工作区 中新建会话" }),
    ).toBeVisible();
    await defaultProject
      .getByRole("button", { name: "默认工作区", exact: true })
      .click({ button: "right" });
    await expect(page.getByRole("menu", { name: "会话或项目操作" })).toHaveCount(0);
    await expect(page.getByText("还没有登记项目。", { exact: false })).toHaveCount(0);
    await page.getByRole("button", { name: "默认工作区", exact: true }).click();
    await expect(page.getByRole("banner")).toContainText("默认工作区");
    await expect(page.getByLabel("对话输入")).toBeEnabled();
    const resources = page.getByLabel("项目资源", { exact: true });
    await expect(resources.getByRole("tablist")).toHaveCount(1);
    await expect(resources.getByRole("button", { name: "刷新文件树" })).toHaveCount(0);
    await expect(resources.getByText("当前工作区暂无文件", { exact: true })).toBeVisible();
    await resources.getByRole("tab", { name: "Git" }).click();
    await expect(resources.getByText("暂无 Git 仓库", { exact: true })).toBeVisible();
    await resources.getByRole("tab", { name: "文件" }).click();
    await expect(resources.getByText("当前工作区暂无文件", { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-12-empty-sidebar.png") });
    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await page.getByRole("button", { name: "新建终端", exact: true }).click();
    await page.getByRole("button", { name: "确认创建" }).click();
    const terminal = page.getByTestId("live-terminal");
    await expect(terminal).toHaveAttribute("data-terminal-id", /^term_/);
    terminalId = (await terminal.getAttribute("data-terminal-id")) ?? "";
    await expect(terminal).toHaveAttribute("data-input-state", "active");
    await terminal
      .locator(".xterm-helper-textarea")
      .pressSequentially(
        process.platform === "win32"
          ? "echo seed> default-note.txt"
          : "printf 'seed\\n' > default-note.txt",
      );
    await terminal.locator(".xterm-helper-textarea").press("Enter");
    await expect(
      page.getByRole("button", { name: "打开文件 default-note.txt", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "终端操作" }).click();
    await page.getByRole("menuitem", { name: "释放输入权" }).click();
    await page.getByRole("button", { name: "隐藏窗口", exact: true }).click();
    await page.getByRole("button", { name: "打开文件 default-note.txt", exact: true }).click();
    const editor = page.locator(".monaco-editor");
    await expect(editor).toBeVisible();
    await expect(page.locator(".view-lines").first()).toContainText("seed");
    await page.getByRole("textbox", { name: "文件内容", exact: true }).focus();
    const modifier = await page.evaluate(() =>
      navigator.userAgent.includes("Macintosh") ? "Meta" : "Control",
    );
    await page.keyboard.press(`${modifier}+A`);
    await page.keyboard.insertText("shared saved\n");
    await expect(page.locator(".view-lines").first()).toContainText("shared saved");
    const saveResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/files" && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "保存文件", exact: true }).click();
    expect((await saveResponse).status()).toBe(200);
    await expect(page.getByText(/UTF-8 · 已同步/)).toBeVisible();
    await page.getByRole("button", { name: "隐藏窗口", exact: true }).click();
    const restoreFile = page.getByRole("button", { name: "恢复 default-note.txt", exact: true });
    await expect(restoreFile).toBeVisible();
    const createA = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/sessions" &&
        response.request().method() === "POST",
    );
    await page.getByLabel("对话输入").fill("list default workspace");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const a = await (await createA).json();
    expect(a.workspaceKind).toBe("default");
    await expect(page.getByText("项目文件已列出。", { exact: true })).toBeVisible();
    await defaultProject.getByRole("button", { name: "在 默认工作区 中新建会话" }).click();
    const createB = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/sessions" &&
        response.request().method() === "POST",
    );
    await page.getByLabel("对话输入").fill("hello default workspace");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const b = await (await createB).json();
    expect(b.id).not.toBe(a.id);
    expect(b.workspacePath).toBe(a.workspacePath);
    await expect(page.getByText("收到。", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("banner")).toContainText("默认工作区");
    await restoreFile.click();
    await expect(editor).toBeVisible();
    await expect(page.locator(".view-lines").first()).toContainText("shared saved");
    await page.getByRole("button", { name: "隐藏窗口", exact: true }).click();
    await page.getByRole("button", { name: "添加项目", exact: true }).click();
    await page.getByLabel("项目目录").fill(root);
    await page.getByRole("dialog").getByRole("button", { name: "添加项目", exact: true }).click();
    await page.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }).click();
    const ordinaryProject = page
      .locator("[data-project-id]")
      .filter({ has: page.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }) });
    await ordinaryProject.getByRole("button", { expanded: true }).click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "重命名项目" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "移除项目" })).toBeVisible();
    await defaultProject
      .getByRole("button", { name: "默认工作区", exact: true })
      .click({ button: "right" });
    await expect(page.getByRole("menu", { name: "会话或项目操作" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "恢复 default-note.txt", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "默认工作区", exact: true }).click();
    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await expect(terminal).toHaveAttribute("data-terminal-id", terminalId);
    await expect(terminal).toHaveAttribute("data-input-state", "active");
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-10-default-terminal.png") });
    await page.getByRole("button", { name: "隐藏窗口", exact: true }).click();
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-10-default-workspace.png") });
    projectId = await page.evaluate(
      async (rootPath) =>
        (await (await fetch("/api/projects")).json()).projects.find(
          (item: { rootPath: string }) => item.rootPath === rootPath,
        )?.id ?? "",
      root,
    );
    expect(errors).toEqual([]);
  } finally {
    await page
      .evaluate(
        async ({ terminalId, projectId }) => {
          const session = await (await fetch("/api/auth/session")).json();
          const headers = { "content-type": "application/json", "x-csrf-token": session.csrfToken };
          if (terminalId)
            await fetch(`/api/terminals/${terminalId}/terminate`, {
              method: "POST",
              headers,
              body: JSON.stringify({ confirmed: true }),
            });
          if (projectId) await fetch(`/api/projects/${projectId}`, { method: "DELETE", headers });
        },
        { terminalId, projectId },
      )
      .catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
