import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
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

test("M3-2 registers a live dev service and shows cards, detail, logs and the owning terminal", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const root = mkdtempSync(path.join(tmpdir(), "larness-services-e2e-"));
  const port = await freePort();
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
    await composer.fill(`service start ${port}`);
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("button", { name: "批准执行" })).toBeVisible();
    await page.getByRole("button", { name: "批准执行" }).click();
    await expect(page.getByText("开发终端已启动。", { exact: true })).toBeVisible({
      timeout: 20_000,
    });

    await page.getByRole("button", { name: "打开服务窗口" }).click();
    const serviceWindow = page.getByRole("dialog", { name: "服务", exact: true });
    await expect(serviceWindow).toBeVisible();
    await expect(serviceWindow.getByText("当前项目暂无服务")).toBeVisible();
    await expect(serviceWindow.getByText(/实际监听端口登记/)).toBeVisible();
    await serviceWindow.getByRole("button", { name: "登记服务" }).first().click();

    const dialog = page.getByRole("dialog", { name: "登记临时服务" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/0\.0\.0\.0.*可登记/)).toBeVisible();
    await dialog.screenshot({ path: test.info().outputPath("service-registration-dialog.png") });
    await dialog.getByLabel("选择终端").selectOption({ index: 1 });
    await dialog.getByLabel("服务名称").fill("web");
    await dialog.getByLabel("服务端口").fill(String(port));
    await dialog.getByRole("button", { name: "继续" }).click();
    await expect(dialog.getByText(/需要审批/)).toBeVisible();
    await dialog.getByRole("button", { name: "批准并登记" }).click();

    await expect(serviceWindow.getByRole("button", { name: "打开终端" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(serviceWindow.getByText(`http://127.0.0.1:${port}`)).toBeVisible();
    await expect(serviceWindow.getByText(/SERVICE_READY/)).toBeVisible({ timeout: 20_000 });
    await serviceWindow.getByRole("button", { name: "返回" }).click();
    await expect(serviceWindow.getByText("web", { exact: true })).toBeVisible();
    await expect(serviceWindow.getByText(`127.0.0.1:${port}`)).toBeVisible();
    await serviceWindow.getByRole("button", { name: /web/ }).click();
    await serviceWindow.getByRole("button", { name: "打开终端" }).click();
    const terminalWindow = page.getByRole("dialog", { name: "backend", exact: true });
    await expect(terminalWindow).toBeVisible();
    await expect(terminalWindow.getByTestId("live-terminal")).toBeVisible();
    await page.screenshot({ path: path.join(tmpdir(), "larness-m3-2-services.png") });
    expect(errors).toEqual([]);
  } finally {
    if (await cleanupProject(page, root)) rmSync(root, { recursive: true, force: true });
  }
});
