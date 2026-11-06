import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

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

async function waitForVite(port: number): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Vite did not start");
}

function mainSource(value: string): string {
  return [
    `export const value = ${JSON.stringify(value)};`,
    `document.querySelector("#app").textContent = value;`,
    "if (import.meta.hot) {",
    "  import.meta.hot.accept((next) => {",
    '    document.querySelector("#app").textContent = next.value;',
    "  });",
    "}",
    'fetch("/api/health")',
    "  .then((response) => response.text())",
    "  .then((text) => {",
    '    document.querySelector("#api").textContent = text;',
    "  });",
    "",
  ].join("\n");
}

test("M3-4 previews a real Vite app through an isolated iframe with HMR and no direct port access", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const root = mkdtempSync(path.join(tmpdir(), "larness-preview-e2e-"));
  const port = await freePort();
  const apiPort = await freePort();
  const requests: string[] = [];
  const sockets: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("websocket", (socket) => sockets.push(socket.url()));
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    writeFileSync(
      path.join(root, "index.html"),
      '<!doctype html><html><body><div id="app"></div><div id="api"></div><script type="module" src="/main.js"></script></body></html>',
    );
    writeFileSync(
      path.join(root, "vite.config.mjs"),
      `export default { server: { proxy: { "/api": "http://127.0.0.1:${apiPort}" } } };\n`,
    );
    writeFileSync(path.join(root, "main.js"), mainSource("v1"));
    await page.setViewportSize({ width: 1440, height: 900 });
    await pair(page);
    await page.getByRole("button", { name: "添加项目" }).click();
    await page.getByLabel("项目目录").fill(root);
    await page.getByRole("dialog").getByRole("button", { name: "添加项目" }).click();
    await page.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }).click();
    const composer = page.getByLabel("对话输入");
    await composer.fill(`service start ${apiPort}`);
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("button", { name: "批准执行" })).toBeVisible();
    await page.getByRole("button", { name: "批准执行" }).click();
    await expect(page.getByText("开发终端已启动。", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await composer.fill(`vite start ${port}`);
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("button", { name: "批准执行" })).toBeVisible();
    await page.getByRole("button", { name: "批准执行" }).click();
    await expect(page.getByText("开发终端已启动。", { exact: true }).last()).toBeVisible({
      timeout: 20_000,
    });
    await waitForVite(port);
    await waitForVite(apiPort);

    await page.getByRole("button", { name: "打开服务窗口" }).click();
    const serviceWindow = page.getByRole("dialog", { name: "服务", exact: true });
    await expect(serviceWindow.getByText("当前项目暂无服务")).toBeVisible();
    await serviceWindow.getByRole("button", { name: "登记服务" }).first().click();
    const dialog = page.getByRole("dialog", { name: "登记临时服务" });
    const frontendOption = dialog.getByRole("option", { name: /frontend/ });
    await expect(frontendOption).toBeAttached();
    await dialog
      .getByLabel("选择终端")
      .selectOption((await frontendOption.getAttribute("value")) ?? "");
    await dialog.getByLabel("服务名称").fill("web");
    await dialog.getByLabel("服务端口").fill(String(port));
    await dialog.getByRole("button", { name: "继续" }).click();
    await dialog.getByRole("button", { name: "批准并登记" }).click();
    await expect(serviceWindow.getByRole("button", { name: "预览" })).toBeEnabled({
      timeout: 20_000,
    });
    await serviceWindow.getByRole("button", { name: "预览" }).click();

    const browser = page.getByRole("dialog", { name: "预览 web", exact: true });
    await expect(browser).toBeVisible();
    const frame = browser.frameLocator('[data-testid="preview-frame"]');
    await expect(frame.locator("#app")).toHaveText("v1", { timeout: 20_000 });
    await expect(frame.locator("#api")).toHaveText("ok", { timeout: 20_000 });

    writeFileSync(path.join(root, "main.js"), mainSource("v2"));
    await expect(frame.locator("#app")).toHaveText("v2", { timeout: 20_000 });

    expect(
      requests.some(
        (url) => url.includes(`127.0.0.1:${port}`) || url.includes(`localhost:${port}`),
      ),
    ).toBe(false);
    expect(sockets.some((url) => url.includes("preview.localhost"))).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: path.join(tmpdir(), "larness-m3-4-preview.png") });

    const bounds = await browser.boundingBox();
    if (!bounds) throw new Error("Preview window is missing");
    const edge = bounds.x + bounds.width - 2;
    const middle = bounds.y + bounds.height / 2;
    await page.mouse.move(edge, middle);
    await page.mouse.down();
    await page.mouse.move(edge - bounds.width + 390, middle, { steps: 5 });
    await page.mouse.up();
    await expect(browser).toHaveCSS("width", "420px");
    await expect(browser.getByText("独立来源", { exact: true })).toHaveCSS("white-space", "nowrap");
    await browser.screenshot({ path: path.join(tmpdir(), "larness-m3-11-preview-narrow.png") });
  } finally {
    if (await cleanupProject(page, root)) rmSync(root, { recursive: true, force: true });
  }
});
