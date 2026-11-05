import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

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

async function controlMenu(page: Page, name: string) {
  if (!(await page.getByRole("menu").isVisible()))
    await page.getByRole("button", { name: "终端操作", exact: true }).click();
  return page.getByRole("menuitem", { name, exact: true });
}

async function prepareProject(page: Page, other: Page): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "larness-terminal-e2e-"));
  await page.getByRole("button", { name: "添加项目" }).click();
  await page.getByLabel("项目目录").fill(root);
  await page.getByRole("dialog").getByRole("button", { name: "添加项目" }).click();
  await page.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }).click();
  await other.reload();
  await other.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }).click();
  return root;
}
async function cleanupTerminalProject(page: Page, root: string): Promise<void> {
  const cleaned = await page
    .evaluate(async (rootPath) => {
      const auth = await (await fetch("/api/auth/session")).json();
      const headers = { "content-type": "application/json", "x-csrf-token": auth.csrfToken };
      const projects = await (await fetch("/api/projects")).json();
      const project = projects.projects.find(
        (item: { rootPath: string }) => item.rootPath === rootPath,
      );
      if (!project) return true;
      const rows = await (await fetch(`/api/terminals?projectId=${project.id}&limit=200`)).json();
      for (const row of rows.items)
        await fetch(`/api/terminals/${row.id}/terminate`, {
          method: "POST",
          headers,
          body: JSON.stringify({ confirmed: true }),
        });
      return (await fetch(`/api/projects/${project.id}`, { method: "DELETE", headers })).ok;
    }, root)
    .catch(() => false);
  if (cleaned) rmSync(root, { recursive: true, force: true });
}

test("M2 terminals: two authenticated observers, exclusive input, replay and explicit tab termination", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const other = await context.newPage();
  let root = "";
  const errors: string[] = [];
  let creates = 0;
  for (const p of [page, other]) {
    p.on("pageerror", (error) => errors.push(error.message));
    p.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === "/api/terminals")
        creates++;
    });
  }
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await pair(page);
    await pair(other);
    root = await prepareProject(page, other);
    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await page
      .getByRole("dialog", { name: "终端", exact: true })
      .getByRole("button", { name: "新建终端", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "创建终端确认" })).toContainText(
      "项目目录不是沙箱",
    );
    await page.getByRole("button", { name: "确认创建" }).click();
    const terminal = page.getByTestId("live-terminal");
    await expect(terminal).toHaveAttribute("data-terminal-id", /^term_/);
    const id = (await terminal.getAttribute("data-terminal-id")) ?? "";
    await other.getByRole("button", { name: "打开终端窗口" }).click();
    await other
      .getByRole("dialog", { name: "终端", exact: true })
      .getByRole("button", { name: `打开终端 ${id}` })
      .click();
    await expect(terminal).toHaveAttribute("data-input-state", "active");
    await expect(other.getByTestId("live-terminal")).toHaveAttribute(
      "data-input-state",
      "inactive",
    );
    await expect(await controlMenu(other, "获取输入权")).toBeDisabled();
    await other.keyboard.press("Escape");
    await terminal
      .locator(".xterm-helper-textarea")
      .pressSequentially("printf 'REAL_PTY_%s\\n' shared", { delay: 10 });
    await terminal.locator(".xterm-helper-textarea").press("Enter");
    await expect(terminal.getByRole("log")).toContainText("REAL_PTY_shared");
    await expect(other.getByTestId("live-terminal").getByRole("log")).toContainText(
      "REAL_PTY_shared",
    );
    await (await controlMenu(page, "释放输入权")).click();
    await (await controlMenu(other, "获取输入权")).click();
    await expect(other.getByTestId("live-terminal")).toHaveAttribute("data-input-state", "active");
    await page.reload();
    await expect(terminal).toHaveAttribute("data-terminal-id", id);
    await expect(terminal.getByRole("log")).toContainText("REAL_PTY_shared");
    await expect(terminal).toHaveAttribute("data-input-state", "inactive");
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-4b-observer.png") });
    await other.reload();
    await expect(other.getByTestId("live-terminal")).toHaveAttribute("data-input-state", "active");
    await (await controlMenu(other, "释放输入权")).click();
    await (await controlMenu(page, "获取输入权")).click();
    await expect(terminal).toHaveAttribute("data-input-state", "active");
    await page.route(
      `**/api/terminals/${id}/terminate`,
      (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "INTERNAL", message: "fixture" } }),
        }),
      { times: 1 },
    );
    await page.getByRole("button", { name: `关闭 Shell ${id.slice(-6)}`, exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "终止未确认" })).toContainText(
      "终止未确认",
    );
    await expect(terminal).toBeVisible();
    await page.getByRole("button", { name: `关闭 Shell ${id.slice(-6)}`, exact: true }).click();
    await expect(terminal).toHaveCount(0);
    await expect(other.getByTestId("live-terminal")).toContainText("已终止");
    expect(creates).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    if (root) await cleanupTerminalProject(page, root);
    await context.close();
  }
});

test("M2 terminal lease failures, expiry and logout preserve the PTY and permit explicit handoff", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const other = await context.newPage();
  let root = "";
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await pair(page);
    await pair(other);
    root = await prepareProject(page, other);
    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await page
      .getByRole("dialog", { name: "终端", exact: true })
      .getByRole("button", { name: "新建终端", exact: true })
      .click();
    await page.getByRole("button", { name: "确认创建" }).click();
    const terminal = page.getByTestId("live-terminal");
    await expect(terminal).toHaveAttribute("data-terminal-id", /^term_/);
    const id = (await terminal.getAttribute("data-terminal-id")) ?? "";
    await other.getByRole("button", { name: "打开终端窗口" }).click();
    await other
      .getByRole("dialog", { name: "终端", exact: true })
      .getByRole("button", { name: `打开终端 ${id}` })
      .click();
    await page.route(`**/api/terminals/${id}/lease`, (route) => {
      if (route.request().postDataJSON().action === "renew")
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "INTERNAL", message: "fixture" } }),
        });
      return route.continue();
    });
    await expect(terminal).toHaveAttribute("data-input-state", "active");
    await expect(terminal.getByRole("alert")).toContainText("续期失败", { timeout: 15000 });
    await (await controlMenu(page, "释放输入权")).click();
    await expect(await controlMenu(other, "获取输入权")).toBeEnabled();
    await (await controlMenu(page, "获取输入权")).click();
    await expect(terminal.getByRole("alert")).toContainText("续期失败", { timeout: 15000 });
    // Keep the authenticated connection open, but let the real 30-second server lease expire.
    await expect(await controlMenu(other, "获取输入权")).toBeEnabled({ timeout: 35000 });
    await (await controlMenu(other, "获取输入权")).click();
    await expect(other.getByTestId("live-terminal")).toHaveAttribute("data-input-state", "active");
    await other.evaluate(async () => {
      const session = await (await fetch("/api/auth/session")).json();
      const result = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "x-csrf-token": session.csrfToken, "content-type": "application/json" },
        body: "{}",
      });
      if (!result.ok) throw new Error("Logout failed");
    });
    await page.unroute(`**/api/terminals/${id}/lease`);
    await expect(await controlMenu(page, "获取输入权")).toBeEnabled();
    await (await controlMenu(page, "获取输入权")).click();
    await expect(terminal).toHaveAttribute("data-input-state", "active");
    await terminal
      .locator(".xterm-helper-textarea")
      .pressSequentially("printf 'HANDOFF_%s\\n' alive");
    await terminal.locator(".xterm-helper-textarea").press("Enter");
    await expect(terminal.getByRole("log")).toContainText("HANDOFF_alive");
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await expect(terminal).toHaveCount(0);
    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await expect(terminal).toHaveAttribute("data-terminal-id", id);
    await expect(terminal.getByRole("log")).toContainText("HANDOFF_alive");
    await expect(terminal).toHaveAttribute("data-input-state", "active");
    await page.getByRole("button", { name: `关闭 Shell ${id.slice(-6)}`, exact: true }).click();
    await expect(terminal).toHaveCount(0);
  } finally {
    if (root) await cleanupTerminalProject(page, root);
    await context.close();
  }
});

test("M2-9 project terminal rename, tab overflow and dock restoration", async ({ page }) => {
  test.setTimeout(90000);
  const root = mkdtempSync(path.join(tmpdir(), "larness-window-e2e-"));
  let projectId = "";
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await pair(page);
    await page.getByRole("button", { name: "添加项目" }).click();
    await page.getByLabel("项目目录").fill(root);
    await page.getByRole("dialog").getByRole("button", { name: "添加项目" }).click();
    await page.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }).click();
    projectId = await page.evaluate(async (rootPath) => {
      const data = await (await fetch("/api/projects")).json();
      return (
        data.projects.find((item: { rootPath: string }) => item.rootPath === rootPath)?.id ?? ""
      );
    }, root);
    expect(projectId).not.toBe("");
    await expect(page.locator("header").getByRole("button", { name: "打开终端窗口" })).toHaveCount(
      0,
    );
    await expect(
      page.getByLabel("项目资源", { exact: true }).getByRole("tab", { name: "终端" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await page.getByRole("button", { name: "新建终端", exact: true }).click();
    await page.getByRole("button", { name: "确认创建" }).click();
    const terminal = page.getByTestId("live-terminal");
    await expect(terminal).toHaveAttribute("data-terminal-id", /^term_/);
    const id = (await terminal.getAttribute("data-terminal-id")) ?? "";
    await expect(terminal).toHaveAttribute("data-input-state", "active");
    await expect(terminal.locator(".xterm-helper-textarea")).toBeFocused();
    await expect(terminal.getByRole("button")).toHaveCount(0);
    await expect(terminal).not.toContainText("只读观察");
    await expect(terminal).not.toContainText("开始输入");
    const first = page.getByRole("tab", { name: `Shell ${id.slice(-6)}`, exact: true });
    await first.dblclick();
    await page.getByLabel("终端名称", { exact: true }).fill("我的开发终端");
    await page.getByLabel("终端名称", { exact: true }).press("Enter");
    await expect(page.getByRole("tab", { name: "我的开发终端", exact: true })).toBeVisible();
    await expect(terminal).toHaveAttribute("data-input-state", "active");
    await terminal.locator(".xterm-helper-textarea").pressSequentially("pwd");
    await terminal.locator(".xterm-helper-textarea").press("Enter");
    await expect(terminal.getByRole("log")).toContainText(realpathSync(root));
    await (await controlMenu(page, "释放输入权")).click();
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await expect(terminal).toHaveAttribute("data-terminal-id", id);
    await page.reload();
    await expect(page.getByRole("tab", { name: "我的开发终端", exact: true })).toBeVisible();
    // Real terminals with long names exercise the same fixed-height strip without CSS mocks.
    for (let index = 0; index < 7; index++) {
      const previousId = await terminal.getAttribute("data-terminal-id");
      await page.getByRole("button", { name: "新建终端 Tab" }).click();
      await expect(page.getByRole("dialog", { name: "创建终端确认" })).toBeVisible();
      await page.getByRole("button", { name: "确认创建" }).click();
      await expect(terminal).not.toHaveAttribute("data-terminal-id", previousId ?? "");
      await expect(terminal).toHaveAttribute("data-terminal-id", /^term_/);
      const currentId = (await terminal.getAttribute("data-terminal-id")) ?? "";
      await page.getByRole("tab", { name: `Shell ${currentId.slice(-6)}`, exact: true }).dblclick();
      await page
        .getByLabel("终端名称", { exact: true })
        .fill(`开发终端 ${index + 1} · frontend watch`);
      await page.getByLabel("终端名称", { exact: true }).press("Enter");
      await expect(
        page.getByRole("tab", { name: `开发终端 ${index + 1} · frontend watch`, exact: true }),
      ).toBeVisible();
    }
    const tabs = page.getByRole("tablist", { name: "窗口 Tab" });
    await expect(tabs.getByRole("tab")).toHaveCount(8);
    await expect(page.getByRole("button", { name: "向左滚动 Tab" })).toBeVisible();
    const geometry = await tabs.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      innerHeight: el.clientHeight,
      scroll: getComputedStyle(el).scrollbarWidth,
      overflow: el.scrollWidth > el.clientWidth,
    }));
    expect(geometry).toEqual({ height: 32, innerHeight: 32, scroll: "none", overflow: true });
    await tabs.evaluate((el) => {
      el.scrollLeft = 0;
    });
    await page.getByRole("tab", { name: "我的开发终端", exact: true }).click();
    await expect(terminal).toHaveAttribute("data-terminal-id", id);
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-9-terminal-tabs.png") });
    await page.getByRole("button", { name: "关闭 我的开发终端", exact: true }).click();
    await expect(tabs.getByRole("tab")).toHaveCount(7);
    expect(
      await page.evaluate(
        async (id) => (await (await fetch(`/api/terminals/${id}`)).json()).status,
        id,
      ),
    ).toBe("TERMINATED");
    await page.getByRole("button", { name: "隐藏窗口", exact: true }).click();
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-9-dock.png") });
  } finally {
    const cleaned = await page
      .evaluate(async (projectId) => {
        if (!projectId) return false;
        const session = await (await fetch("/api/auth/session")).json();
        const headers = { "content-type": "application/json", "x-csrf-token": session.csrfToken };
        const rows = await (await fetch(`/api/terminals?projectId=${projectId}&limit=200`)).json();
        for (const row of rows.items)
          await fetch(`/api/terminals/${row.id}/terminate`, {
            method: "POST",
            headers,
            body: JSON.stringify({ confirmed: true }),
          });
        return (await fetch(`/api/projects/${projectId}`, { method: "DELETE", headers })).ok;
      }, projectId)
      .catch(() => false);
    if (cleaned) rmSync(root, { recursive: true, force: true });
  }
});
