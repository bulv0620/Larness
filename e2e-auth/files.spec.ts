import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, type Route, test } from "@playwright/test";
import { execFileSync } from "./support";

test.setTimeout(120_000);
async function replaceEditor(page: Page, text: string) {
  await page.getByRole("textbox", { name: "文件内容", exact: true }).focus();
  const modifier = await page.evaluate(() =>
    navigator.userAgent.includes("Macintosh") ? "Meta" : "Control",
  );
  await page.keyboard.press(`${modifier}+A`);
  await page.keyboard.insertText(text);
}

test("M2 files edit real bytes, retain conflicting drafts, confirm close and restore local views", async ({
  page,
  browser,
}) => {
  const root = mkdtempSync(path.join(tmpdir(), "larness-files-e2e-"));
  const file = path.join(root, "note.txt");
  const initial = Array.from({ length: 2500 }, (_, index) => `line ${index}`).join("\r\n");
  writeFileSync(file, initial);
  writeFileSync(path.join(root, "large.txt"), "x".repeat(512 * 1024 + 1));
  writeFileSync(path.join(root, "syntax.ts"), "export const value = 1;\n");
  writeFileSync(path.join(root, "syntax.tsx"), "");
  writeFileSync(path.join(root, "syntax.js"), "");
  writeFileSync(path.join(root, "vercel.json"), "{}");
  writeFileSync(path.join(root, "bom.txt"), "\uFEFFBOM seed\r\n");
  mkdirSync(path.join(root, "sub"));
  const child = path.join(root, "sub", "child.txt");
  writeFileSync(child, "child\n");
  for (let i = 0; i < 36; i++) writeFileSync(path.join(root, `z-scroll-${i}.txt`), "");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/pair");
    const panel = page.locator("[data-request-id]");
    await expect(panel).toHaveAttribute("data-stage", "waiting");
    const id = await panel.getAttribute("data-request-id");
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
          id ?? "",
          "allow_once",
        ],
        { encoding: "utf8" },
      ),
    );
    await page.getByLabel("配对码").fill(approved.code);
    await page.getByRole("button", { name: "兑换配对码" }).click();
    await expect(page.getByTestId("workspace-home")).toBeVisible();
    await page.getByRole("button", { name: "添加项目" }).click();
    await page.getByLabel("项目目录").fill(root);
    await page.getByRole("dialog").getByRole("button", { name: "添加项目" }).click();
    await page.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }).click();
    const resources = page.getByLabel("项目资源", { exact: true });
    await expect(resources.getByRole("tablist")).toHaveCount(1);
    await expect(resources.getByRole("button", { name: "刷新文件树" })).toHaveCount(0);
    await expect(resources.getByText(/文件监听|正在连接文件/)).toHaveCount(0);
    await resources.getByRole("tab", { name: "Git" }).click();
    const gitEmpty = resources.getByText("Git 暂不可用", { exact: true });
    await expect(gitEmpty).toBeVisible();
    await expect(gitEmpty).not.toHaveClass(/text-danger/);
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-12-resource-sidebar.png") });
    await page.getByRole("button", { name: "折叠项目资源" }).click();
    const composer = page.getByRole("textbox", { name: "对话输入" });
    await composer.fill("保留对话草稿");
    await composer.press("Meta+p");

    const quickOpen = page.getByRole("dialog", { name: "快速打开文件" });
    const search = quickOpen.getByRole("combobox", { name: "文件名或相对路径" });
    await expect(search).toBeFocused();
    await search.press("Escape");
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("保留对话草稿");
    await composer.press("Control+p");
    await expect(search).toBeFocused();
    await search.fill("sub/chd");
    await expect(quickOpen.getByRole("option", { name: /child.txt.*sub/ })).toBeVisible();
    const results = quickOpen.getByRole("listbox");
    await expect(results).toHaveCSS("margin-top", "8px");
    await expect(results).toHaveCSS("margin-bottom", "8px");
    await page.screenshot({ path: path.join(tmpdir(), "larness-fr-6-quick-open.png") });
    await search.press("Enter");
    await expect(quickOpen).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "child.txt", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "关闭 child.txt" }).click();
    await composer.fill("");
    await page.getByRole("button", { name: "展开项目资源" }).click();
    await resources.getByRole("tab", { name: "文件" }).click();
    const filePanel = resources.getByRole("tabpanel", { name: "文件" });
    const tools = filePanel.getByRole("toolbar", { name: "文件操作" });
    const newFileButton = tools.getByRole("button", { name: "新建文件" });
    await expect(newFileButton).toBeVisible();
    const top = (await tools.boundingBox())?.y;
    await filePanel.evaluate((panel) => {
      panel.scrollTop = 180;
    });
    await expect.poll(() => filePanel.evaluate((panel) => panel.scrollTop)).toBeGreaterThan(100);
    await expect.poll(async () => (await tools.boundingBox())?.y).toBeCloseTo(top ?? -1, 0);
    await expect(tools).toHaveCSS("position", "sticky");
    const blur = await tools.evaluate(
      (element) => getComputedStyle(element, "::before").backdropFilter,
    );
    expect(blur).toContain("blur(");
    const toolbarBounds = await tools.boundingBox();
    const panelBounds = await filePanel.boundingBox();
    expect(toolbarBounds?.width).toBeLessThan((panelBounds?.width ?? 0) * 0.6);
    expect(
      await tools.evaluate((element) => getComputedStyle(element, "::before").background),
    ).toMatch(/^rgba\(0, 0, 0, 0\) /);
    await expect(newFileButton).toBeEnabled();
    await page.screenshot({ path: path.join(tmpdir(), "larness-fr-9-compact-toolbar.png") });
    await filePanel.evaluate((panel) => {
      panel.scrollTop = 0;
    });

    await resources.getByRole("button", { name: "快速打开文件" }).click();
    await search.press("Escape");
    await expect(quickOpen).toHaveCount(0);
    await page.getByRole("button", { name: "打开文件 bom.txt", exact: true }).click();
    const vercelIcon = resources
      .getByRole("button", { name: "打开文件 vercel.json" })
      .locator("[style*='--file-icon']");
    await expect(vercelIcon).toHaveCSS("background-image", /vercel_light.*\.svg/);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await expect(vercelIcon).toHaveCSS("background-image", /vercel(?!_light).*\.svg/);
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    const syntaxRow = resources.getByRole("button", { name: "打开文件 syntax.ts", exact: true });
    const treeIcon = syntaxRow.locator("[style*='--file-icon']");
    await expect(treeIcon).toHaveCSS("background-image", /typescript.*\.svg/);
    const iconUrl = await treeIcon.evaluate((element) =>
      getComputedStyle(element).backgroundImage.slice(5, -2),
    );
    expect((await page.request.get(iconUrl)).ok()).toBe(true);
    await resources.getByRole("button", { name: "快速打开文件" }).click();
    await search.fill("syntax");
    const resultIcon = quickOpen
      .getByRole("option", { name: /^syntax\.ts / })
      .locator("[style*='--file-icon']");
    await expect(resultIcon).toHaveCSS("background-image", /typescript.*\.svg/);
    await expect(
      quickOpen.getByRole("option", { name: /^syntax\.tsx / }).locator("[style*='--file-icon']"),
    ).toHaveCSS("background-image", /react_ts.*\.svg/);
    await page.screenshot({ path: path.join(tmpdir(), "larness-fr-7-file-icons.png") });
    await quickOpen.getByRole("option", { name: /^syntax\.ts / }).click();
    const syntaxTab = page.getByRole("tab", { name: "syntax.ts", exact: true });
    await expect(syntaxTab.locator("[style*='--file-icon']")).toHaveCSS(
      "background-image",
      /typescript.*\.svg/,
    );
    await page.getByRole("button", { name: "关闭 syntax.ts" }).click();
    const bomTab = page.getByRole("tab", { name: /^bom\.txt/ });
    await expect(bomTab.locator("span.italic")).toHaveText("bom.txt");
    const noteRow = page.getByRole("button", { name: "打开文件 note.txt", exact: true });
    await noteRow.click();
    await expect(bomTab).toHaveCount(0);
    const noteTab = page.getByRole("tab", { name: /^note\.txt/ });
    await expect(noteTab.locator("span.italic")).toHaveText("note.txt");
    await noteRow.dblclick();
    await expect(noteTab.locator("span.italic")).toHaveCount(0);
    await expect(noteTab).toBeVisible();
    const editor = page.getByRole("textbox", { name: "文件内容", exact: true });
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.focus();
    const macBindings = await page.evaluate(() => navigator.userAgent.includes("Macintosh"));
    await test.info().attach("editor-platform", {
      body: JSON.stringify(
        await page.evaluate(() => ({
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          focusedElement: document.activeElement?.tagName,
        })),
      ),
      contentType: "application/json",
    });
    await page.keyboard.press(macBindings ? "Meta+ArrowDown" : "Control+End");
    await expect(page.locator(".view-lines").first()).toContainText("line 2499");
    await replaceEditor(page, "mine\r\n");
    const saveButton = page.getByRole("button", { name: "保存文件", exact: true });
    const editorPosition = await editor.boundingBox();
    const rejectSave = async (route: Route) => {
      if (route.request().method() !== "PUT") return route.fallback();
      await route.fulfill({
        status: 409,
        json: { error: { code: "RESOURCE_LOCKED", message: "Project is locked" } },
      });
    };
    await page.route("**/api/files", rejectSave);
    await saveButton.click();
    const failure = page.getByRole("alert").filter({ hasText: /项目正在写入/ });
    await expect(failure).toHaveCSS("position", "fixed");
    expect(await editor.boundingBox()).toEqual(editorPosition);
    await failure.getByRole("button", { name: "关闭错误消息" }).click();
    await expect(failure).toHaveCount(0);
    await page.unroute("**/api/files", rejectSave);
    await saveButton.click();
    await expect.poll(() => readFileSync(file, "utf8")).toBe("mine\r\n");
    await replaceEditor(page, "unsaved draft\r\n");
    await page.getByRole("button", { name: "隐藏窗口", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole("button", { name: "恢复 note.txt", exact: true }).click();
    await expect(editor).toBeVisible();
    await expect(page.locator(".view-lines").first()).toContainText("unsaved draft");
    let injectedConflict = false;
    await page.route("**/api/files", async (route) => {
      if (route.request().method() === "PUT" && !injectedConflict) {
        injectedConflict = true;
        writeFileSync(file, "external\r\n");
      }
      await route.continue();
    });
    const conflictResponse = page.waitForResponse(
      (response) => response.url().endsWith("/api/files") && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "保存文件", exact: true }).click();
    expect((await conflictResponse).status()).toBe(409);
    await expect(page.getByText("磁盘文件已变化，草稿已保留。", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole("button", { name: "查看差异", exact: true }).click();
    await expect(page.getByText("磁盘版本 → 本地草稿", { exact: true })).toBeVisible();
    expect(readFileSync(file, "utf8")).toBe("external\r\n");
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-2-conflict.png") });
    await page.getByRole("button", { name: "手工合并", exact: true }).click();
    await replaceEditor(page, "merged\r\n");
    await page.getByRole("button", { name: "关闭 note.txt", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "未保存的文件" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "取消", exact: true }).click();
    await expect(editor).toBeVisible();
    await page.getByRole("button", { name: "关闭 note.txt", exact: true }).click();
    await confirm.getByRole("button", { name: "保存并关闭", exact: true }).click();
    await expect.poll(() => readFileSync(file, "utf8")).toBe("merged\r\n");
    await expect(editor).toHaveCount(0);
    await page.getByRole("button", { name: "打开文件 large.txt", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "不支持编辑" })).toBeVisible();
    expect(readFileSync(path.join(root, "large.txt")).length).toBe(512 * 1024 + 1);
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("unsaved draft");
    await page.getByRole("button", { name: "打开文件 bom.txt", exact: true }).click();
    await expect(editor).toBeVisible();
    await replaceEditor(page, "BOM saved\r\n");
    await page.getByRole("button", { name: "保存文件", exact: true }).click();
    await expect
      .poll(() => readFileSync(path.join(root, "bom.txt"), "utf8"))
      .toBe("\uFEFFBOM saved\r\n");
    await replaceEditor(page, "BOM draft\r\n");
    expect(
      await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(true);
    await page.getByRole("button", { name: "隐藏窗口", exact: true }).click();
    await page.getByRole("button", { name: "目录 sub", exact: true }).click();
    await page.getByRole("button", { name: "打开文件 child.txt", exact: true }).click();
    await expect(editor).toBeVisible();
    await page.getByRole("tab", { name: /^bom\.txt/ }).click();
    await expect(page.locator(".view-lines").first()).toContainText("BOM draft");
    await page.getByRole("button", { name: "关闭 bom.txt", exact: true }).click();
    await confirm.getByRole("button", { name: "放弃改动", exact: true }).click();
    await expect(page.locator(".view-lines").first()).toContainText("child");
    await resources.getByRole("button", { name: "全部折叠" }).click();
    await resources.getByRole("tab", { name: "Git" }).click();
    await page.getByRole("button", { name: "在文件树中定位" }).click();
    const childRow = resources.getByRole("button", { name: "打开文件 child.txt" });
    await expect(childRow).toBeFocused();
    await expect(childRow).toHaveAttribute("aria-current", "true");
    await page.screenshot({ path: path.join(tmpdir(), "larness-fr-1-file-tree.png") });
    await childRow.press("ArrowLeft");
    await expect(resources.getByRole("button", { name: "目录 sub" })).toBeFocused();
    await expect(page.getByRole("tab", { name: /^child\.txt/ }).locator("span.italic")).toHaveText(
      "child.txt",
    );
    expect(readFileSync(path.join(root, "bom.txt"), "utf8")).toBe("\uFEFFBOM saved\r\n");
    writeFileSync(child, "external child\n");
    await expect(page.locator(".view-lines").first()).toContainText("external child", {
      timeout: 10_000,
    });
    await replaceEditor(page, "retain on deletion\n");
    await expect(page.getByRole("tab", { name: /^child\.txt/ }).locator("span.italic")).toHaveCount(
      0,
    );
    await childRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "删除…" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "删除文件" });
    await expect(deleteDialog).toContainText("sub/child.txt");
    const cancelDelete = deleteDialog.getByRole("button", { name: "取消" });
    await expect(cancelDelete).toBeFocused();
    const confirmDelete = deleteDialog.getByRole("button", { name: "确认删除" });
    const dangerFill = await confirmDelete.evaluate(
      (button) => getComputedStyle(button).backgroundColor,
    );
    await expect(confirmDelete).not.toHaveClass(/hover:bg-surface-2/);
    await confirmDelete.hover();
    await expect(confirmDelete).toHaveCSS("background-color", dangerFill);
    await expect(confirmDelete).toHaveCSS("color", "rgb(255, 255, 255)");
    await cancelDelete.click();
    expect(readFileSync(child, "utf8")).toBe("external child\n");
    await childRow.click({ button: "right" });
    await page.getByRole("menuitem", { name: "删除…" }).click();
    await deleteDialog.getByRole("button", { name: "确认删除" }).click();
    await expect(deleteDialog).toHaveCount(0);
    await expect(childRow).toHaveCount(0);
    await expect
      .poll(() => {
        try {
          readFileSync(child);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    await expect(page.locator(".view-lines").first()).toContainText("retain on deletion");

    await expect(page.getByRole("alert").filter({ hasText: "文件不可用" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: "保存文件", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "关闭 child.txt", exact: true }).click();
    await confirm.getByRole("button", { name: "保存并关闭", exact: true }).click();
    await expect(confirm.getByRole("alert")).toContainText("文件不可用");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "放弃改动", exact: true }).click();
    const observerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const observer = await observerContext.newPage();
      await observer.goto(new URL("/pair", page.url()).toString());
      const observerPanel = observer.locator("[data-request-id]");
      await expect(observerPanel).toHaveAttribute("data-stage", "waiting");
      const observerId = await observerPanel.getAttribute("data-request-id");
      const observerApproval = JSON.parse(
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
            observerId ?? "",
            "allow_once",
          ],
          { encoding: "utf8" },
        ),
      );
      await observer.getByLabel("配对码").fill(observerApproval.code);
      await observer.getByRole("button", { name: "兑换配对码" }).click();
      await expect(observer.getByTestId("workspace-home")).toBeVisible();
      await observer.getByRole("button", { name: `在 ${path.basename(root)} 中新建会话` }).click();
      await expect(observer.getByRole("button", { name: "目录 sub" })).toBeVisible();
      await resources.getByRole("button", { name: "目录 sub" }).focus();
      await resources.getByRole("button", { name: "新建目录" }).click();
      const newDir = resources.getByRole("textbox", { name: "新目录名" });
      await expect(newDir).toBeFocused();
      await newDir.fill("   ");
      await newDir.press("Tab");
      await expect(newDir).toHaveCount(0);
      await resources.getByRole("button", { name: "新建目录" }).click();
      await newDir.fill("destination");
      await newDir.press("Tab");
      await expect(newDir).toHaveCount(0);
      const destination = resources.getByRole("button", { name: "目录 destination" });
      await expect(destination).toBeFocused();
      await resources.getByRole("button", { name: "新建文件" }).click();
      const newFile = resources.getByRole("textbox", { name: "新文件名" });
      await newFile.fill("draft.txt");
      await newFile.press("Tab");
      await expect(newFile).toHaveCount(0);
      await expect(editor).toBeVisible();
      await replaceEditor(page, "draft follows rename and move");
      const fileRow = resources.getByRole("button", { name: "打开文件 draft.txt" });
      await fileRow.click({ button: "right" });
      await page.getByRole("menuitem", { name: "重命名" }).click();
      const rename = resources.getByRole("textbox", { name: "新名称" });
      await rename.fill("moved.txt");
      await rename.press("Enter");
      await expect(page.getByRole("tab", { name: /^moved\.txt/ })).toBeVisible();
      const renamedRow = resources.getByRole("button", { name: "打开文件 moved.txt" });
      await expect(resources.getByRole("button", { name: "moved.txt 的文件操作" })).toHaveCount(0);
      await renamedRow.press("Shift+F10");
      await expect(page.getByRole("menuitem", { name: "移动到…" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await renamedRow.click({ button: "right" });
      await page.getByRole("menuitem", { name: "移动到…" }).click();
      const move = page.getByRole("dialog", { name: "移动文件" });
      await move.getByRole("button", { name: "移到这里" }).click();
      await expect(move).toHaveCount(0);
      await expect(page.locator(".view-lines").first()).toContainText(
        "draft follows rename and move",
      );
      await saveButton.click();
      await expect
        .poll(() => readFileSync(path.join(root, "moved.txt"), "utf8"))
        .toBe("draft follows rename and move");
      const movedRow = observer.getByRole("button", { name: "打开文件 moved.txt" });
      await expect(movedRow).toBeVisible();
      await movedRow.click();
      await expect(observer.locator(".view-lines")).toContainText("draft follows rename and move");
    } finally {
      await observerContext.close();
    }
    // Monaco reports a benign console error when the diff model is disposed after merge.
    expect(errors.filter((error) => !error.includes("no diff result available"))).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
