import { expect, test } from "@playwright/test";

test.describe("Harness S0 视觉 Demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Harness", { exact: true }).first()).toBeVisible();
  });

  test("三栏布局与右侧资源分区", async ({ page }) => {
    await expect(page.getByLabel("项目与会话导航").last()).toBeVisible();
    await expect(page.getByLabel("项目资源", { exact: true })).toBeVisible();
    await expect(page.getByLabel("对话输入")).toBeVisible();
    await expect(page.getByText(/^最近/).first()).toBeVisible();
    await expect(page.getByRole("separator")).toHaveCount(3);

    const fileHeader = page.getByRole("button", { name: /^文件/ }).first();
    await fileHeader.click();
    await expect(page.getByText("AppShell.tsx", { exact: true })).toHaveCount(0);
    await fileHeader.click();
    await expect(page.getByText("AppShell.tsx", { exact: true })).toBeVisible();
  });

  test("双击分隔线均分相邻资源分区", async ({ page }) => {
    const sections = page.locator('aside[aria-label="项目资源"] section');
    const files = sections.nth(0);
    const services = sections.nth(1);
    const beforeFiles = await files.boundingBox();
    const beforeServices = await services.boundingBox();
    expect(beforeFiles).not.toBeNull();
    expect(beforeServices).not.toBeNull();

    await page.getByRole("separator", { name: "调整资源分区高度" }).first().dblclick();
    await page.waitForTimeout(250);

    const afterFiles = await files.boundingBox();
    const afterServices = await services.boundingBox();
    expect(afterFiles).not.toBeNull();
    expect(afterServices).not.toBeNull();
    expect(Math.abs((afterFiles?.height ?? 0) - (afterServices?.height ?? 0))).toBeLessThan(4);
  });

  test("切换项目时资源栏与空态跟随", async ({ page }) => {
    await page.getByText("整理文档站首页导航", { exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "整理文档站首页导航" })).toBeVisible();
    await expect(
      page.getByLabel("项目资源", { exact: true }).getByText("docs-site", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("暂无文件预览")).toBeVisible();
    await expect(page.getByText("未检测到 Git 仓库", { exact: false })).toBeVisible();
  });

  test("资源区 Tab 可聚焦单项并返回全部", async ({ page }) => {
    await page.getByRole("tab", { name: /^文件/ }).click();
    await expect(page.locator('aside[aria-label="项目资源"] section')).toHaveCount(1);
    await expect(page.getByText("AppShell.tsx", { exact: true })).toBeVisible();
    await expect(page.getByText("web-dev", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("separator")).toHaveCount(0);

    await page.getByRole("tab", { name: "全部" }).click();
    await expect(page.locator('aside[aria-label="项目资源"] section')).toHaveCount(4);
    await expect(page.getByRole("separator")).toHaveCount(3);
    await expect(page.getByText("web-dev", { exact: true })).toBeVisible();
  });

  test("上下文菜单与文件树折叠可用", async ({ page }) => {
    await page.getByRole("button", { name: "添加上下文" }).click();
    await page.getByRole("menuitem", { name: "@README.md" }).click();
    await expect(page.getByLabel("对话输入")).toHaveValue(/@README\.md/);

    const tree = page.getByLabel("项目资源", { exact: true });
    await tree.getByText("apps", { exact: true }).click();
    await expect(tree.getByText("AppShell.tsx", { exact: true })).toHaveCount(0);
    await tree.getByText("apps", { exact: true }).click();
    await expect(tree.getByText("AppShell.tsx", { exact: true })).toBeVisible();
  });

  test("主题切换并持久化", async ({ page }) => {
    await page.getByRole("button", { name: "外观与主题" }).click();
    await page.getByRole("menuitemradio", { name: /深色/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByLabel("项目资源", { exact: true })).toBeVisible();
  });

  test("窗口打开、隐藏、恢复、最大化与关闭", async ({ page }) => {
    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await expect(page.locator(".window-drag-handle")).toHaveCount(1);
    await expect(page.locator(".xterm")).toBeVisible();

    await page.getByRole("button", { name: "隐藏窗口" }).click();
    await expect(page.locator(".window-drag-handle")).toHaveCount(0);

    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await expect(page.locator(".window-drag-handle")).toHaveCount(1);
    await page.getByRole("button", { name: "最大化窗口" }).click();
    await expect(page.getByRole("button", { name: "还原窗口" })).toBeVisible();
    await page.getByRole("button", { name: "还原窗口" }).click();
    await page.getByRole("button", { name: "关闭窗口" }).click();
    await expect(page.locator(".window-drag-handle")).toHaveCount(0);
  });

  test("文件窗口加载 Monaco 只读内容", async ({ page }) => {
    await page.getByRole("button", { name: "打开文件窗口" }).click();
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".view-lines")).toContainText("ConversationWorkspace");
    await expect(page.getByText("只读预览")).toBeVisible();
  });

  test("发送消息、流式输出与部署审批", async ({ page }) => {
    await page.getByLabel("对话输入").fill("把开发服务启动起来，并给我一个预览。");
    await page.getByLabel("发送消息").click();

    await expect(page.getByText("执行计划").last()).toBeVisible();
    await expect(page.getByText("开发服务器已启动", { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "批准部署" }).click();
    await expect(page.getByText("已批准部署", { exact: false })).toBeVisible();
    await expect(page.getByText("部署成功", { exact: true })).toBeVisible();
  });

  test("键盘快捷键与窗口 Escape", async ({ page }) => {
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("heading", { name: "新会话" })).toBeVisible();
    await expect(page.getByLabel("对话输入")).toBeFocused();

    await page.keyboard.press("Control+b");
    await expect(page.getByLabel("项目与会话导航")).toHaveCount(0);
    await page.keyboard.press("Control+b");

    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await expect(page.locator(".window-drag-handle")).toHaveCount(1);
    await page.locator(".window-drag-handle").click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".window-drag-handle")).toHaveCount(0);
  });

  test("窄屏隐藏资源栏并打开移动端导航", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(page.getByLabel("项目资源", { exact: true })).toBeHidden();

    await page.setViewportSize({ width: 700, height: 900 });
    await expect(page.getByLabel("项目与会话导航").last()).toBeHidden();
    await page.getByRole("button", { name: "打开导航" }).click();
    await expect(page.getByLabel("项目与会话导航").last()).toBeVisible();
  });
});
