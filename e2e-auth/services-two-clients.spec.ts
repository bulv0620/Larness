import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { execFileSync } from "./support";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
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
        (item) => item.realPath === rootPath || item.rootPath === rootPath,
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

async function previewOrigin(page: Page): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const frame = page.frames().find((item) => item.url().includes("preview.localhost"));
    if (frame) return new URL(frame.url()).hostname;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("preview frame did not attach");
}

async function registerService(page: Page, port: number) {
  await page.getByRole("button", { name: "打开服务窗口" }).click();
  const serviceWindow = page.getByRole("dialog", { name: "服务", exact: true });
  await serviceWindow.getByRole("button", { name: "登记服务" }).first().click();
  const dialog = page.getByRole("dialog", { name: "登记临时服务" });
  await dialog.getByRole("button", { name: "选择终端" }).click();
  await page.getByRole("menuitemradio").first().click();
  await dialog.getByLabel("服务名称").fill("web");
  await dialog.getByLabel("服务端口").fill(String(port));
  await dialog.getByRole("button", { name: "继续" }).click();
  await dialog.getByRole("button", { name: "批准并登记" }).click();
  await expect(serviceWindow.getByRole("button", { name: "预览" })).toBeEnabled({
    timeout: 20_000,
  });
  return serviceWindow;
}

test("M3-6 two authenticated clients share the service card but get independent preview grants", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const root = mkdtempSync(path.join(tmpdir(), "larness-two-clients-"));
  const port = await freePort();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let second: Page | null = null;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await pair(page);
    await page.getByRole("button", { name: "添加项目" }).click();
    await page.getByLabel("项目目录").fill(root);
    await page.getByRole("dialog").getByRole("button", { name: "添加项目" }).click();
    await page.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }).click();
    const composer = page.getByLabel("对话输入");
    await composer.fill(`service start ${port}`);
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("button", { name: "批准执行" })).toBeVisible();
    await page.getByRole("button", { name: "批准执行" }).click();
    await expect(page.getByText("开发终端已启动。", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    const firstWindow = await registerService(page, port);
    await firstWindow.getByRole("button", { name: "预览" }).click();
    const firstBrowser = page.getByRole("dialog", { name: "预览 web", exact: true });
    const firstFrame = firstBrowser.frameLocator('[data-testid="preview-frame"]');
    await expect(firstFrame.locator("body")).toContainText("ok", { timeout: 20_000 });
    const firstOrigin = await previewOrigin(page);

    const secondContext = await (browser as Browser).newContext();
    second = await secondContext.newPage();
    await pair(second);
    await second.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }).click();
    const secondWindow = await registerService(second, port).catch(async () => {
      // The service already exists for this project; open the details instead of re-registering.
      await second.getByRole("button", { name: "打开服务窗口" }).click();
      const window = second.getByRole("dialog", { name: "服务", exact: true });
      await window.getByRole("button", { name: /web/ }).click();
      await expect(window.getByRole("button", { name: "预览" })).toBeEnabled({ timeout: 20_000 });
      return window;
    });
    await secondWindow.getByRole("button", { name: "预览" }).click();
    const secondBrowser = second.getByRole("dialog", { name: "预览 web", exact: true });
    const secondFrame = secondBrowser.frameLocator('[data-testid="preview-frame"]');
    await expect(secondFrame.locator("body")).toContainText("ok", { timeout: 20_000 });
    const secondOrigin = await previewOrigin(second);
    expect(secondOrigin).not.toBe(firstOrigin);

    await firstBrowser.getByRole("button", { name: "关闭窗口" }).click();
    await expect(secondFrame.locator("body")).toContainText("ok");
    expect(errors).toEqual([]);
  } finally {
    if (second) await second.context().close();
    if (await cleanupProject(page, root)) rmSync(root, { recursive: true, force: true });
  }
});
