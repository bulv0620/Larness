import { execFileSync } from "node:child_process";
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

test("M2 terminals: two authenticated observers, exclusive input, replay and explicit tab termination", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const other = await context.newPage();
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
    await terminal.getByRole("button", { name: "获取输入权" }).click();
    await expect(terminal).toContainText("你正在控制");
    await expect(other.getByTestId("live-terminal")).toContainText("只读观察");
    await expect(other.getByRole("button", { name: "获取输入权" })).toBeDisabled();
    await terminal
      .locator(".xterm-helper-textarea")
      .pressSequentially("printf 'REAL_PTY_%s\\n' shared", { delay: 10 });
    await terminal.locator(".xterm-helper-textarea").press("Enter");
    await expect(terminal.getByRole("log")).toContainText("REAL_PTY_shared");
    await expect(other.getByTestId("live-terminal").getByRole("log")).toContainText(
      "REAL_PTY_shared",
    );
    await terminal.getByRole("button", { name: "释放输入权" }).click();
    await other.getByRole("button", { name: "获取输入权" }).click();
    await expect(other.getByTestId("live-terminal")).toContainText("你正在控制");
    await page.reload();
    await expect(terminal).toHaveAttribute("data-terminal-id", id);
    await expect(terminal.getByRole("log")).toContainText("REAL_PTY_shared");
    await expect(terminal).toContainText("只读观察");
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-4b-observer.png") });
    await other.reload();
    await expect(other.getByTestId("live-terminal")).toContainText("只读观察");
    await terminal.getByRole("button", { name: "获取输入权" }).click();
    await expect(terminal).toContainText("你正在控制");
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
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await pair(page);
    await pair(other);
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
    await terminal.getByRole("button", { name: "获取输入权" }).click();
    await expect(terminal.getByRole("alert")).toContainText("续期失败", { timeout: 15000 });
    await terminal.getByRole("button", { name: "释放输入权" }).click();
    await expect(other.getByRole("button", { name: "获取输入权" })).toBeEnabled();
    await terminal.getByRole("button", { name: "获取输入权" }).click();
    await expect(terminal.getByRole("alert")).toContainText("续期失败", { timeout: 15000 });
    // Keep the authenticated connection open, but let the real 30-second server lease expire.
    await expect(other.getByRole("button", { name: "获取输入权" })).toBeEnabled({ timeout: 35000 });
    await other.getByRole("button", { name: "获取输入权" }).click();
    await expect(other.getByTestId("live-terminal")).toContainText("你正在控制");
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
    await expect(terminal.getByRole("button", { name: "获取输入权" })).toBeEnabled();
    await terminal.getByRole("button", { name: "获取输入权" }).click();
    await expect(terminal).toContainText("你正在控制");
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
    await expect(terminal).toContainText("只读观察");
    await terminal.getByRole("button", { name: "终止终端" }).click();
    await expect(terminal).toContainText("已终止");
  } finally {
    await context.close();
  }
});
