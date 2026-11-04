import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

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
}) => {
  const root = mkdtempSync(path.join(tmpdir(), "larness-files-e2e-"));
  const file = path.join(root, "note.txt");
  const initial = Array.from({ length: 2500 }, (_, index) => `line ${index}`).join("\r\n");
  writeFileSync(file, initial);
  writeFileSync(path.join(root, "large.txt"), "x".repeat(512 * 1024 + 1));
  writeFileSync(path.join(root, "bom.txt"), "\uFEFFBOM seed\r\n");
  mkdirSync(path.join(root, "sub"));
  const child = path.join(root, "sub", "child.txt");
  writeFileSync(child, "child\n");
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
    await page.getByRole("button", { name: "打开文件 note.txt", exact: true }).click();
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
    await page.getByRole("button", { name: "保存文件", exact: true }).click();
    await expect.poll(() => readFileSync(file, "utf8")).toBe("mine\r\n");
    await replaceEditor(page, "unsaved draft\r\n");
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
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
    await page.screenshot({ path: "/tmp/larness-m2-2-conflict.png" });
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
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await page.getByRole("button", { name: "目录 sub", exact: true }).click();
    await page.getByRole("button", { name: "打开文件 child.txt", exact: true }).click();
    await expect(editor).toBeVisible();
    await page.getByRole("tab", { name: /^bom\.txt/ }).click();
    await expect(page.locator(".view-lines").first()).toContainText("BOM draft");
    await page.getByRole("button", { name: "关闭 bom.txt", exact: true }).click();
    await confirm.getByRole("button", { name: "放弃改动", exact: true }).click();
    await expect(page.locator(".view-lines").first()).toContainText("child");
    expect(readFileSync(path.join(root, "bom.txt"), "utf8")).toBe("\uFEFFBOM saved\r\n");
    writeFileSync(child, "external child\n");
    await expect(page.locator(".view-lines").first()).toContainText("external child", {
      timeout: 10_000,
    });
    await replaceEditor(page, "retain on deletion\n");
    rmSync(child);
    await expect(page.getByRole("alert").filter({ hasText: "文件不可用" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: "保存文件", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "关闭 child.txt", exact: true }).click();
    await confirm.getByRole("button", { name: "保存并关闭", exact: true }).click();
    await expect(confirm.getByRole("alert")).toContainText("文件不可用");
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "放弃改动", exact: true }).click();
    expect(errors).toEqual([]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
