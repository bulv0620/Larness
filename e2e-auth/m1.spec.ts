import { mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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

test("adds a browsed project directly from the directory picker", async ({ page }) => {
  await page.goto("/pair");
  const pairPanel = page.locator("[data-request-id]");
  await expect(pairPanel).toHaveAttribute("data-stage", "waiting");
  const approved = ipc(
    "approve",
    (await pairPanel.getAttribute("data-request-id")) ?? "",
    "allow_once",
  );
  await page.getByLabel("配对码").fill(approved.code ?? "");
  await page.getByRole("button", { name: "兑换配对码" }).click();
  await expect(page.getByTestId("workspace-home")).toBeVisible();

  const home = realpathSync(homedir());
  const projectDir = mkdtempSync(path.join(home, "larness-picker-"));
  let projectId: string | undefined;

  try {
    await page.getByRole("button", { name: "添加项目", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "添加项目" });
    const projectPath = dialog.getByLabel("项目目录");
    await expect(dialog.getByRole("button", { name: "添加项目", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "磁盘与卷" }).click();
    const root = path.parse(home).root;
    const disk = page.getByRole("menuitem", {
      name: process.platform === "win32" ? root.slice(0, 2) : root,
      exact: true,
    });
    await disk.click();
    await expect(projectPath).toHaveValue(root);
    await dialog.getByRole("button", { name: "主目录", exact: true }).click();
    await dialog.getByRole("button", { name: path.basename(projectDir), exact: true }).click();
    await expect(projectPath).toHaveValue(projectDir);
    await expect(dialog.getByRole("button", { name: "选择当前目录" })).toHaveCount(0);
    await dialog.getByLabel("显示名称（可选）").fill("目录选择验收");
    await dialog.screenshot({ path: test.info().outputPath("project-directory.png") });

    const created = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/projects" &&
        response.request().method() === "POST",
    );
    await dialog.getByLabel("显示名称（可选）").press("Enter");
    const response = await created;
    expect(response.status()).toBe(201);
    const project = await response.json();
    projectId = project.id;
    expect(project).toMatchObject({ name: "目录选择验收", rootPath: projectDir });
    await expect(dialog).toBeHidden();
  } finally {
    if (projectId) {
      await page.evaluate(async (id) => {
        const { csrfToken } = await (await fetch("/api/auth/session")).json();
        await fetch(`/api/projects/${id}`, {
          method: "DELETE",
          headers: { "x-csrf-token": csrfToken },
        });
      }, projectId);
    }
    rmdirSync(projectDir);
  }
});

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
  const add = page.getByRole("dialog", { name: "添加 Key" });
  const addWidth = (await add.boundingBox())?.width;
  await add.getByLabel("凭据名称").fill("目录同步测试");
  await add.getByLabel("API Key").fill("placeholder-key");
  await add.getByRole("button", { name: "添加", exact: true }).click();
  await expect(add).toBeHidden();
  const syncedKey = dialog.getByRole("button", { name: /目录同步测试.*2 个模型/ });
  await expect(syncedKey).toBeVisible();
  await expect(syncedKey).toHaveAttribute("aria-pressed", "true");
  const models = dialog.getByRole("region", { name: "目录同步测试 模型" });
  await expect(models.getByText("DeepSeek Flash", { exact: true })).toBeVisible();
  await dialog.screenshot({ path: test.info().outputPath("model-settings.png") });
  await models.getByRole("button", { name: "管理 Key" }).click();
  const manage = page.getByRole("dialog", { name: "管理 Key" });
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("The model settings test requires a fixed viewport");
  const nameInput = manage.getByLabel("连接名称");
  const keyInput = manage.getByLabel("替换 API Key");
  const desktop = await nameInput.boundingBox();
  expect(desktop).not.toBeNull();
  expect(addWidth).toBeDefined();
  expect((await manage.boundingBox())?.width).toBe(addWidth);
  expect((await keyInput.boundingBox())?.x).toBe(desktop?.x);
  expect((await keyInput.boundingBox())?.width).toBe(desktop?.width);

  await manage.screenshot({ path: test.info().outputPath("manage-key-desktop.png") });
  await page.setViewportSize({ width: 375, height: 320 });
  const mobile = await nameInput.boundingBox();
  expect(mobile).not.toBeNull();
  expect((await keyInput.boundingBox())?.x).toBe(mobile?.x);
  const cancel = manage.getByRole("button", { name: "取消" });
  await cancel.scrollIntoViewIfNeeded();
  await expect(cancel).toBeInViewport();
  await manage.screenshot({ path: test.info().outputPath("manage-key-mobile.png") });
  await page.setViewportSize(viewport);
  await cancel.click();
  await expect(manage).toBeHidden();
  await models.getByRole("button", { name: "删除 Key" }).click();
  const confirmDelete = page.getByRole("dialog", { name: "删除 Key？" });
  await confirmDelete.getByRole("button", { name: "删除" }).click();
  await expect(dialog.getByRole("button", { name: /目录同步测试/ })).toHaveCount(0);
});

test("keeps a screenshot draft across model switches and replays the sent image", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("larness.theme", "dark"));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/pair");
  const pairPanel = page.locator("[data-request-id]");
  await expect(pairPanel).toHaveAttribute("data-stage", "waiting");
  const approved = ipc(
    "approve",
    (await pairPanel.getAttribute("data-request-id")) ?? "",
    "allow_once",
  );
  await page.getByLabel("配对码").fill(approved.code ?? "");
  await page.getByRole("button", { name: "兑换配对码" }).click();
  await expect(page.getByTestId("workspace-home")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "在 默认工作区 中新建会话" }).click({ timeout: 10_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  const input = page.getByLabel("对话输入");
  await input.evaluate((element) => {
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a44QAAAAASUVORK5CYII=";
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "fixture.png", { type: "image/png" }));
    element.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });
  await expect(page.getByRole("img", { name: "fixture.png" })).toBeVisible();
  const select = async (name: string) => {
    const trigger = page.getByRole("button", { name: /^模型与思考：/ });
    await expect(trigger).not.toContainText("E2E Key");
    await trigger.click();
    const picker = page.getByRole("dialog", { name: "模型与思考" });
    await expect(picker.getByRole("button", { name: /^思考强度：/ })).toBeVisible();
    if (name === "DeepSeek Chat") {
      await picker.screenshot({ path: test.info().outputPath("mobile-model-menu.png") });
    }
    await picker.getByRole("button", { name: /^模型：/ }).click();
    await expect(picker.getByText("E2E Key", { exact: true })).toBeVisible();
    await picker.getByRole("button", { name, exact: true }).click();
  };
  await select("DeepSeek Chat");
  await expect(page.getByRole("button", { name: "发送消息" })).toBeDisabled();
  await expect(page.getByRole("img", { name: "fixture.png" })).toBeVisible();
  await select("DeepSeek Flash");
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("img", { name: "用户截图" })).toBeVisible();
  await page.reload();
  const screenshot = page.getByRole("img", { name: "用户截图" });
  await expect(screenshot).toBeVisible();
  await expect
    .poll(() => screenshot.evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBe(1);
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
    await page.getByRole("button", { name: /执行过程 · Completed · .*1 步/ }).click();
    await expect(page.getByText("我先看一下。")).toBeVisible();
    await page.getByRole("button", { name: /执行过程 · Completed · .*1 步/ }).click();
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
    const strictPolicy = page.getByRole("button", { name: "审批策略：严格审批" });
    await expect(strictPolicy).toBeEnabled();
    await page.reload();
    await expect(strictPolicy).toBeVisible({ timeout: 15_000 });

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
    await picker.getByRole("button", { name: /^模型：/ }).click();
    await picker.getByRole("button", { name: "DeepSeek Chat", exact: true }).click();
    await expect(picker).toBeHidden();
    await expect(page.getByRole("button", { name: "模型与思考：DeepSeek Chat" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "模型与思考：DeepSeek Chat" })).toBeVisible({
      timeout: 15_000,
    });

    await composer.fill("list again");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByText("项目文件已列出。")).toHaveCount(2, { timeout: 20_000 });

    await composer.fill("cancel");
    await page.getByRole("button", { name: "发送消息" }).click();
    await expect(page.getByRole("button", { name: /执行过程 ·/ }).last()).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "停止执行" }).click({ timeout: 10_000 });
    await expect(page.getByText("已停止当前执行。")).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: "设置与模型" }).click();
    const modelSettings = page.getByRole("dialog", { name: "模型与凭据" });
    await modelSettings.getByRole("button", { name: /E2E.*2 个模型/ }).click();
    const defaultModel = modelSettings.getByRole("button", { name: "DeepSeek Flash", exact: true });
    const defaultStar = modelSettings.getByLabel("新会话默认模型");
    await defaultModel.click();
    const actions = modelSettings.getByRole("group", { name: "DeepSeek Flash 操作" });
    await expect(actions).toBeVisible();
    await actions.getByRole("button", { name: "详情", exact: true }).click();
    const details = page.getByRole("dialog", { name: "模型能力" });
    await expect(details).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(details).toBeHidden();
    await actions.getByRole("button", { name: "设为默认" }).click();
    await expect(defaultStar).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modelSettings).toBeHidden();

    const modelControl = page.getByRole("button", { name: /^模型与思考：/ });
    await expect(modelControl).toHaveAccessibleName(/DeepSeek Chat/);
    await page.getByText("新建会话", { exact: true }).first().click();
    await expect(page.getByText("草稿")).toHaveCount(1);
    await expect(modelControl).toHaveAccessibleName(/DeepSeek Flash/);
    await sidebar.getByRole("button", { name: "Renamed chat", exact: true }).first().click();
    await expect(modelControl).toHaveAccessibleName(/DeepSeek Chat/);
    await expect(page.getByText("草稿")).toHaveCount(0);

    await page.getByRole("button", { name: "设置与模型" }).click();
    await modelSettings.getByRole("button", { name: /E2E.*2 个模型/ }).click();
    const showFlash = modelSettings.getByRole("button", { name: "DeepSeek Flash 在会话中显示" });
    await showFlash.click();
    await expect(showFlash).toHaveAttribute("aria-pressed", "false");
    await expect(defaultStar).toHaveCount(0);
    await expect(defaultModel).toHaveAttribute("aria-expanded", "false");
    await defaultModel.click();
    await expect(actions.getByRole("button", { name: "设为默认" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(modelSettings).toBeHidden();

    await page.getByText("新建会话", { exact: true }).first().click();
    await expect(modelControl).toHaveAccessibleName(/DeepSeek Chat/);
    await sidebar.getByRole("button", { name: "Renamed chat", exact: true }).first().click();

    await page.getByRole("button", { name: "设置与模型" }).click();
    await modelSettings.getByRole("button", { name: /E2E.*2 个模型/ }).click();
    await showFlash.click();
    await expect(showFlash).toHaveAttribute("aria-pressed", "true");
    await expect(defaultStar).toHaveCount(0);
    await defaultModel.focus();
    await page.keyboard.press("Enter");
    await expect(actions.getByRole("button", { name: "设为默认" })).toBeEnabled();
    await defaultModel.click();
    await expect(actions).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(modelSettings).toBeHidden();
    await page.getByRole("button", { name: "设置与模型" }).click();
    await modelSettings.getByRole("button", { name: "添加 Key" }).click();
    const add = page.getByRole("dialog", { name: "添加 Key" });
    await add.getByLabel("凭据名称").fill("E2E secret");
    await add.getByLabel("API Key").fill("sk-e2e-secret-value");
    await add.getByRole("button", { name: "添加", exact: true }).click();
    const newKey = modelSettings.getByRole("region", { name: "E2E secret 模型" });
    await expect(newKey).toBeVisible();
    await newKey.getByRole("button", { name: "管理 Key" }).click();
    const manage = page.getByRole("dialog", { name: "管理 Key" });
    await expect(manage.getByText(/•+/)).toBeVisible();
    await expect(manage.getByLabel("替换 API Key")).toHaveValue("");
    await expect(manage.getByText("sk-e2e-secret-value")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(manage).toBeHidden();
    await expect(modelSettings).toBeVisible();
    await page.keyboard.press("Escape");

    expect(pageErrors).toEqual([]);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
  }
});
