import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { execFileSync } from "./support";

test.setTimeout(120_000);

interface IpcResult {
  code?: string;
  ok?: boolean;
}

function ipc(command: string, ...args: string[]): IpcResult {
  const output = execFileSync(
    "pnpm",
    [
      "--silent",
      "--filter",
      "@larness/server",
      "exec",
      "tsx",
      "../../scripts/e2e-ipc.ts",
      command,
      ...args,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  return JSON.parse(output.trim()) as IpcResult;
}

test("shows the running version in the workspace header", async ({ page }) => {
  await page.goto("/pair");
  const pairPanel = page.locator("[data-request-id]");
  await expect(pairPanel).toHaveAttribute("data-stage", "waiting", { timeout: 10_000 });
  const requestId = await pairPanel.getAttribute("data-request-id");
  const approved = ipc("approve", requestId ?? "", "allow_once");
  expect(approved.code).toBeTruthy();
  await page.getByLabel("配对码").fill(approved.code ?? "");
  await page.getByRole("button", { name: "兑换配对码" }).click();

  const header = page.getByRole("banner");
  const metadata = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  await expect(header.getByText(`v${metadata.version}`, { exact: true })).toBeVisible();

  await page.route("**/api/bootstrap", async (route) => {
    const response = await route.fetch();
    const bootstrap = await response.json();
    await route.fulfill({ response, json: { ...bootstrap, app: { name: "Larness" } } });
  });
  await page.reload();
  await expect(header.getByText("版本未知", { exact: true })).toBeVisible();
});

test("synchronizes models after a Key is added", async ({ page }) => {
  await page.goto("/pair");
  const pairPanel = page.locator("[data-request-id]");
  await expect(pairPanel).toHaveAttribute("data-stage", "waiting", { timeout: 10_000 });
  const requestId = await pairPanel.getAttribute("data-request-id");
  const approved = ipc("approve", requestId ?? "", "allow_once");
  expect(approved.code).toBeTruthy();
  await page.getByLabel("配对码").fill(approved.code ?? "");
  await page.getByRole("button", { name: "兑换配对码" }).click();
  await expect(page.getByTestId("workspace-home")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "设置与模型" }).click();
  const dialog = page.getByRole("dialog", { name: "模型与凭据" });
  await dialog.getByRole("button", { name: "添加 Key" }).click();
  await dialog.getByLabel("凭据名称").fill("目录同步测试");
  await dialog.getByLabel("API Key").fill("placeholder-key");
  await dialog.getByRole("button", { name: "添加", exact: true }).click();
  const syncedKey = dialog.getByRole("button", { name: /目录同步测试.*2 个模型/ });
  await expect(syncedKey).toBeVisible();
  await syncedKey.click();
  await dialog.getByRole("button", { name: "删除 Key" }).click();
  const confirmDelete = page.getByRole("dialog", { name: "删除 Key？" });
  await confirmDelete.getByRole("button", { name: "删除" }).click();
  await expect(dialog.getByRole("button", { name: /目录同步测试/ })).toHaveCount(0);
});

test("M1 runs a real turn, approves a patch, restores after refresh, switches model and cancels", async ({
  page,
  request,
}) => {
  await expect
    .poll(
      async () => {
        const response = await request.get("/api/bootstrap");
        const body = (await response.json()) as { initialized?: boolean };
        return body.initialized;
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  await page.setViewportSize({ width: 1440, height: 900 });
  const projectDir = mkdtempSync(path.join(tmpdir(), "larness-m1-e2e-"));
  const noteFile = path.join(projectDir, "note.txt");
  let projectName = path.basename(projectDir);
  writeFileSync(noteFile, "seed\n");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto("/pair");
    const pairPanel = page.locator("[data-request-id]");
    await expect(pairPanel).toHaveAttribute("data-stage", "waiting", { timeout: 10_000 });
    const requestId = await pairPanel.getAttribute("data-request-id");
    expect(requestId).toBeTruthy();

    const approved = ipc("approve", requestId ?? "", "allow_once");
    expect(approved.code).toBeTruthy();

    await page.getByLabel("配对码").fill(approved.code ?? "");
    await page.getByRole("button", { name: "兑换配对码" }).click();
    await expect(page.getByTestId("workspace-home")).toBeVisible({ timeout: 15_000 });

    const resources = page.getByRole("complementary", { name: "项目资源" });
    await expect(resources).toBeVisible();
    const filesTab = resources.getByRole("tab", { name: /^文件/ });
    await expect(filesTab).toHaveAttribute("aria-selected", "true");
    await expect(resources.locator("#resource-files")).toBeVisible();
    const gitTab = resources.getByRole("tab", { name: /^Git/ });
    await gitTab.click();
    await expect(gitTab).toHaveAttribute("aria-selected", "true");
    await expect(resources.locator("#resource-git")).toBeVisible();
    await filesTab.click();
    await expect(filesTab).toHaveAttribute("aria-selected", "true");
    await expect(resources.locator("#resource-files")).toBeVisible();

    await page.getByRole("main").getByRole("button", { name: "折叠项目资源" }).click();
    await expect(resources).toHaveCount(0);
    await page.getByRole("main").getByRole("button", { name: "展开项目资源" }).click();
    await expect(page.getByRole("complementary", { name: "项目资源" })).toBeVisible();

    await page.getByRole("button", { name: "添加项目" }).click();
    const projectDialog = page.getByRole("dialog");
    await projectDialog.getByLabel("项目目录").fill(projectDir);
    await projectDialog.getByRole("button", { name: "添加项目" }).click();
    await expect(page.getByText(projectName).first()).toBeVisible({ timeout: 10_000 });

    await page.getByText(projectName).first().click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await page.getByRole("menuitem", { name: "重命名项目" }).click();
    const projectRename = page.getByRole("dialog");
    await projectRename.getByLabel("项目名称").fill("E2E Renamed Project");
    await projectRename.getByRole("button", { name: "保存" }).click();
    await expect(page.getByText("E2E Renamed Project").first()).toBeVisible({ timeout: 10_000 });
    projectName = "E2E Renamed Project";

    await page.getByRole("button", { name: `在 ${projectName} 中新建会话` }).click();
    const composer = page.getByLabel("对话输入");
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("草稿")).toHaveCount(1);
    await page.getByText("新建会话", { exact: true }).first().click();
    await expect(page.getByText("草稿")).toHaveCount(1);

    await composer.fill("list");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("项目文件已列出。")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("我先看一下。")).toHaveCount(0);
    await page.getByRole("button", { name: /执行过程 · 探索 1 项/ }).click();
    await expect(page.getByText("我先看一下。")).toBeVisible();
    await page.getByRole("button", { name: /执行过程 · 探索 1 项/ }).click();
    await expect(page.getByRole("heading", { name: "list" })).toBeVisible();
    await expect(page.getByText("草稿")).toHaveCount(0);

    const sidebar = page.getByLabel("项目与会话导航");
    await sidebar
      .getByRole("button", { name: "list", exact: true })
      .first()
      .click({ button: "right" });
    await expect(page.getByRole("menu")).toBeVisible();
    await page.getByRole("menuitem", { name: "重命名会话" }).click();
    const sessionRename = page.getByRole("dialog");
    await sessionRename.getByLabel("会话标题").fill("Renamed chat");
    await sessionRename.getByRole("button", { name: "保存" }).click();
    await expect(sidebar.getByText("Renamed chat").first()).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: /审批策略：/ }).click();
    await page.getByRole("menuitemradio", { name: /严格审批/ }).click();

    await composer.fill("approve");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("region", { name: "待处理审批" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "批准执行" }).click();
    await expect(page.getByText("补丁已应用。")).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() => readFileSync(noteFile, "utf8"), { timeout: 10_000 })
      .toContain("approved");

    const fileCard = page.getByRole("button", { name: "查看文件 · note.txt", exact: true });
    await fileCard.click();
    await expect(page.getByRole("textbox", { name: "文件内容", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await fileCard.click();
    await expect(page.getByRole("button", { name: "关闭 note.txt", exact: true })).toHaveCount(1);
    expect(readFileSync(noteFile, "utf8")).toBe("seed\napproved\n");
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();

    await page.reload();
    await expect(page.getByTestId("workspace-home")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("补丁已应用。")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "批准执行" })).toHaveCount(0);
    await expect(page.getByRole("progressbar", { name: "上下文用量" })).toHaveAttribute(
      "aria-valuetext",
      /单次输入：12,000 \/ 1,048,576/,
    );

    await page.getByRole("button", { name: /模型与思考：/ }).click();
    const picker = page.getByRole("dialog", { name: "模型与思考" });
    await picker.getByRole("button", { name: /模型：/ }).click();
    await picker.getByRole("button", { name: /DeepSeek Chat/ }).click();
    await expect(picker).toBeHidden();
    await expect(
      page.getByRole("button", { name: "模型与思考：DeepSeek Chat · 不支持" }),
    ).toBeVisible();

    await composer.fill("list again");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("项目文件已列出。")).toHaveCount(2, { timeout: 20_000 });

    await composer.fill("cancel");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("正在处理…")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "停止执行" }).click({ timeout: 10_000 });
    await expect(page.getByText("已停止当前执行。")).toBeVisible({ timeout: 20_000 });

    await page.getByText("新建会话", { exact: true }).first().click();
    await expect(page.getByText("草稿")).toHaveCount(1);
    await sidebar.getByRole("button", { name: "Renamed chat", exact: true }).first().click();
    await expect(page.getByText("草稿")).toHaveCount(0);

    await page.getByRole("button", { name: "设置与模型" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "添加 Key" }).click();
    await page.getByRole("dialog").getByLabel("凭据名称").fill("E2E secret");
    await page.getByRole("dialog").getByLabel("API Key").fill("sk-e2e-secret-value");
    await page.getByRole("dialog").getByRole("button", { name: "添加" }).click();
    await expect(page.getByRole("dialog").getByText("sk-e2e-secret-value")).toHaveCount(0);
    await expect(page.getByRole("dialog").getByText(/•+/).first()).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    expect(pageErrors).toEqual([]);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
