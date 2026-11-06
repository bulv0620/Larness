import { expect, test } from "@playwright/test";

test.describe("Larness S0 视觉 Demo", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Larness", { exact: true }).first()).toBeVisible();
  });

  test("三栏布局与右侧资源分区", async ({ page }) => {
    await expect(page.getByLabel("项目与会话导航").last()).toBeVisible();
    await expect(page.getByLabel("项目资源", { exact: true })).toBeVisible();
    await expect(page.getByLabel("对话输入")).toBeVisible();
    await expect(page.getByText(/^最近/).first()).toBeVisible();
    const fileHeader = page.getByRole("button", { name: /^文件/ }).first();
    await fileHeader.click();
    await expect(page.locator("#resource-files")).toHaveAttribute("aria-hidden", "true");
    await fileHeader.click();
    await expect(page.locator("#resource-files")).toHaveAttribute("aria-hidden", "false");
    await expect(page.getByText("AppShell.tsx", { exact: true })).toBeVisible();
  });

  test("切换资源分区时只有当前分区展开", async ({ page }) => {
    const aside = page.getByLabel("项目资源", { exact: true });
    await aside.getByRole("button", { name: /^Git/ }).first().click();
    await page.waitForTimeout(250);
    await expect(aside.locator("#resource-files")).toHaveAttribute("aria-hidden", "true");
    await expect(aside.locator("#resource-git")).toHaveAttribute("aria-hidden", "false");
  });

  test("切换项目时资源栏与空态跟随", async ({ page }) => {
    await page.getByText("整理文档站首页导航", { exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "整理文档站首页导航" })).toBeVisible();
    await expect(
      page.getByLabel("项目资源", { exact: true }).getByText("docs-site", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("项目资源", { exact: true }).getByText("当前项目暂无文件", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("暂无 Git 仓库", { exact: true })).toBeVisible();
  });

  test("右侧文件与 Git 同时展示且没有视图 Tab", async ({ page }) => {
    const aside = page.getByLabel("项目资源", { exact: true });
    await expect(aside.getByRole("tablist")).toHaveCount(0);
    await expect(aside.getByRole("tab")).toHaveCount(0);
    await expect(aside.locator("section")).toHaveCount(2);
    await expect(aside.getByRole("button", { name: /^文件/ }).first()).toBeVisible();
    await expect(aside.getByRole("button", { name: /^Git/ }).first()).toBeVisible();
    await expect(aside.getByText("AppShell.tsx", { exact: true })).toBeVisible();
    await expect(page.getByLabel("项目窗口")).toBeVisible();
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

  test("展开 Git 后文件分区收起且 Git 填满右栏", async ({ page }) => {
    const aside = page.getByLabel("项目资源", { exact: true });
    await aside.getByRole("button", { name: /^Git/ }).first().click();
    await page.waitForTimeout(250);

    const sections = aside.locator("section");
    await expect(sections).toHaveCount(2);
    const filesBox = await sections.nth(0).boundingBox();
    const asideBox = await aside.boundingBox();
    const lastBox = await sections.last().boundingBox();
    expect(filesBox?.height ?? 0).toBeLessThan(60);
    expect(asideBox).not.toBeNull();
    expect(lastBox).not.toBeNull();
    const gap =
      (asideBox?.y ?? 0) + (asideBox?.height ?? 0) - ((lastBox?.y ?? 0) + (lastBox?.height ?? 0));
    expect(gap).toBeLessThan(20);
  });

  test("项目窗口独立且没有 header 入口或项目筛选", async ({ page }) => {
    await expect(page.locator("header").getByRole("button", { name: "打开终端窗口" })).toHaveCount(
      0,
    );
    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await expect(page.getByRole("tab", { name: "pnpm dev" })).toBeVisible();
    await expect(page.getByLabel("项目筛选")).toHaveCount(0);
    await page.getByText("整理文档站首页导航", { exact: true }).first().click();
    await expect(page.locator(".window-drag-handle")).toHaveCount(0);
    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await expect(page.getByRole("tab", { name: "pnpm docs:dev" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "pnpm dev", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await expect(page.getByRole("tab", { name: "pnpm docs:dev" })).toBeVisible();
  });

  test("输入区与时间线之间没有硬分割线", async ({ page }) => {
    const dock = page.getByTestId("composer-dock");
    await expect(dock).toHaveCSS("border-top-width", "0px");
    await expect(dock).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  });

  test("左右侧栏可拖动调宽并双击复位", async ({ page }) => {
    const nav = page.getByLabel("项目与会话导航");
    const resources = page.getByLabel("项目资源", { exact: true });
    const leftHandle = page.getByRole("separator", { name: "调整项目侧栏宽度" });
    const rightHandle = page.getByRole("separator", { name: "调整资源侧栏宽度" });

    const leftBefore = (await nav.boundingBox())?.width ?? 0;
    const leftBox = await leftHandle.boundingBox();
    expect(leftBox).not.toBeNull();
    expect(leftBox?.width ?? 0).toBeLessThan(2);
    if (leftBox) {
      await page.mouse.move(leftBox.x + 3, leftBox.y + 300);
      await page.mouse.down();
      await page.mouse.move(leftBox.x + 43, leftBox.y + 300);
      await page.mouse.up();
    }
    const leftAfter = (await nav.boundingBox())?.width ?? 0;
    expect(leftAfter).toBeGreaterThan(leftBefore + 20);
    await leftHandle.dblclick();
    await expect.poll(async () => Math.round((await nav.boundingBox())?.width ?? 0)).toBe(268);

    const rightBefore = (await resources.boundingBox())?.width ?? 0;
    const rightBox = await rightHandle.boundingBox();
    expect(rightBox).not.toBeNull();
    if (rightBox) {
      await page.mouse.move(rightBox.x + 3, rightBox.y + 300);
      await page.mouse.down();
      await page.mouse.move(rightBox.x - 37, rightBox.y + 300);
      await page.mouse.up();
    }
    const rightAfter = (await resources.boundingBox())?.width ?? 0;
    expect(rightAfter).toBeGreaterThan(rightBefore + 20);
    await rightHandle.dblclick();
    await expect
      .poll(async () => Math.round((await resources.boundingBox())?.width ?? 0))
      .toBe(340);
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
    const frame = page.locator("[data-window-frame]");
    const terminal = frame.locator(".xterm");
    await expect(terminal).toBeVisible();
    await terminal.evaluate((node) => node.setAttribute("data-original-screen", "true"));

    await page.getByRole("button", { name: "隐藏窗口" }).click();
    await expect(frame).toBeHidden();
    await expect(frame).toHaveCount(1);
    await expect(terminal).toHaveAttribute("data-original-screen", "true");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await expect(terminal).toBeVisible();
    await expect(terminal).toHaveAttribute("data-original-screen", "true");
    await page.getByRole("button", { name: "最大化窗口" }).click();
    await expect(page.getByRole("button", { name: "还原窗口" })).toBeVisible();
    await page.getByRole("button", { name: "还原窗口" }).click();
    await page.getByRole("button", { name: "关闭窗口" }).click();
    await expect(frame).toBeHidden();
  });

  test("点击窗口外同时最小化资源窗口，保留原有 Tab", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1080 });
    const dock = page.getByRole("navigation", { name: "项目窗口" });
    const frames = page.locator("[data-window-frame]:visible");
    await dock.getByRole("button", { name: "打开终端窗口" }).click();
    await dock.getByRole("button", { name: "打开服务窗口" }).click();
    await expect(frames).toHaveCount(2);
    const theme = page.getByRole("button", { name: "外观与主题" });
    await theme.click();
    await expect(frames).toHaveCount(0);
    await expect(page.getByRole("menuitemradio", { name: /深色/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await dock.getByRole("button", { name: "打开终端窗口" }).click();
    await expect(page.getByRole("tab", { name: "pnpm dev", selected: true })).toBeVisible();
    await expect(frames).toHaveCount(1);
  });

  test("点击外部保留置顶窗口，收起动画可从浮栏取消", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1080 });
    const dock = page.getByRole("navigation", { name: "项目窗口" });
    const terminalButton = dock.getByRole("button", { name: "打开终端窗口" });
    const serviceButton = dock.getByRole("button", { name: "打开服务窗口" });
    await terminalButton.click();
    await serviceButton.click();
    const frames = page.locator("[data-window-frame]:visible");
    await expect(frames).toHaveCount(2);
    const terminal = frames.filter({ has: page.getByRole("tab", { name: "pnpm dev" }) });
    const service = page.getByRole("dialog", { name: "web-dev", exact: true });
    await service.getByRole("button", { name: "置顶窗口" }).click();

    // Hold the actual window animation midway to inspect hit testing and restore it.
    await terminal.evaluate((frame) => {
      document.addEventListener(
        "pointerdown",
        () => {
          for (const animation of frame.getAnimations()) {
            animation.pause();
            animation.currentTime = 100;
          }
        },
        { capture: true, once: true },
      );
    });
    const composer = page.getByLabel("对话输入");
    await composer.click();
    await expect(service.getByRole("button", { name: "取消置顶" })).toBeVisible();
    await expect(composer).toBeFocused();
    await expect(terminal).toHaveCSS("pointer-events", "none");
    await testInfo.attach("pinned-window-and-minimize", {
      body: await page.screenshot(),
      contentType: "image/png",
    });

    await terminalButton.click();
    await expect(terminal).toHaveCSS("pointer-events", "auto");
    await expect(terminal.getByRole("tab", { name: "pnpm dev", selected: true })).toBeVisible();
    await serviceButton.click();
    await service.getByRole("button", { name: "隐藏窗口" }).click();
    await expect(service).toHaveCount(0);
    await serviceButton.click();
    await service.getByRole("button", { name: "取消置顶" }).click();
    await composer.click();
    await expect(frames).toHaveCount(0);
  });

  test("最大化资源窗口盖住终端和服务浮栏", async ({ page }) => {
    const dock = page.getByRole("navigation", { name: "项目窗口" });
    await dock.getByRole("button", { name: "打开终端窗口" }).click();
    await page.getByRole("button", { name: "最大化窗口" }).click();
    await expect(page.getByRole("button", { name: "还原窗口" })).toBeVisible();
    await expect
      .poll(() =>
        dock.evaluate((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          const target = document.elementFromPoint(x + width / 2, y + height / 2);
          return Boolean(target?.closest("[data-window-frame]"));
        }),
      )
      .toBe(true);
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await dock.getByRole("button", { name: "打开服务窗口" }).click();
    await expect(page.locator("[data-window-frame]:visible")).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: "web-dev", exact: true })).toBeVisible();
  });

  test("文件窗口加载 Monaco 只读内容", async ({ page }) => {
    await page
      .getByLabel("项目资源", { exact: true })
      .getByText("AppShell.tsx", { exact: true })
      .click();
    await expect(page.locator(".monaco-editor")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".view-lines")).toContainText("ConversationWorkspace");
    await expect(page.getByText("只读预览")).toBeVisible();
  });

  test("发送消息、流式输出与部署审批", async ({ page }) => {
    await page.getByLabel("对话输入").fill("把开发服务启动起来，并给我一个预览。");
    await expect(page.getByLabel("发送消息")).toBeDisabled();
    await page.getByRole("button", { name: "批准部署" }).click();
    await expect(page.getByText("已批准部署", { exact: false })).toBeVisible();
    await expect(page.getByText("部署成功", { exact: true })).toBeVisible();
    await page.getByLabel("发送消息").click();
    await expect(page.getByRole("button", { name: /计划 ·/ }).last()).toBeVisible();
    await expect(page.getByText("开发服务器已启动", { exact: false })).toBeVisible({
      timeout: 10_000,
    });
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
    await expect(page.locator(".window-drag-handle")).toBeHidden();
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
