import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("keeps the autonomous confirmation readable on hover and keyboard focus", async ({ page }) => {
  await page.goto("/");
  for (const theme of ["浅色", "深色"]) {
    await page.getByRole("button", { name: "外观与主题" }).click();
    await page.getByRole("menuitemradio", { name: theme, exact: false }).click();
    await page.getByRole("button", { name: "审批策略：标准审批" }).click();
    await page.getByRole("menuitemradio", { name: /完全自主/ }).click();

    const dialog = page.getByRole("dialog", { name: "启用完全自主？" });
    const confirm = dialog.getByRole("button", { name: "确认启用" });
    await expect(confirm).toBeVisible();
    const background = await confirm.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    );
    await confirm.hover();
    await expect(confirm).toHaveCSS("filter", "brightness(1.1)");
    await expect(confirm).toHaveCSS("background-color", background);
    await expect(confirm).toHaveCSS("color", "rgb(255, 255, 255)");

    await dialog.getByRole("heading").hover();
    await dialog.getByRole("button", { name: "取消" }).press("Tab");
    await expect(confirm).toBeFocused();
    await expect(confirm).toHaveCSS("background-color", background);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});

test("conversation actions follow the outer light/dark theme without expanding the compact layout", async ({
  page,
}) => {
  await page.goto("/");
  const panel = page.getByRole("region", { name: "待处理审批" });
  await expect(panel).toBeVisible();
  const activity = page.getByRole("status", { name: "当前执行状态" });
  await expect(activity).toHaveText("等待审批");
  await expect(
    page.getByRole("log", { name: "会话时间线" }).getByRole("status", { name: "当前执行状态" }),
  ).toHaveCount(0);
  for (const theme of ["浅色", "深色"]) {
    await page.getByRole("button", { name: "外观与主题" }).click();
    await page.getByRole("menuitemradio", { name: theme, exact: false }).click();
    const accent = await page.evaluate(() => {
      const sample = document.createElement("span");
      sample.style.backgroundColor = "var(--accent)";
      document.body.append(sample);
      const color = getComputedStyle(sample).backgroundColor;
      sample.remove();
      return color;
    });
    await expect(panel.getByRole("button", { name: "批准部署" })).toHaveCSS(
      "background-color",
      accent,
    );
    const input = page.getByLabel("对话输入");
    const approvalBox = await panel.boundingBox();
    const inputBox = await input.boundingBox();
    expect(
      approvalBox && inputBox && approvalBox.y + approvalBox.height <= inputBox.y,
    ).toBeTruthy();
    expect(
      (await page.getByLabel("项目窗口", { exact: true }).boundingBox())?.height,
    ).toBeLessThanOrEqual(32);
    await page.screenshot({
      path: path.join(tmpdir(), `larness-m2-16-${theme === "浅色" ? "light" : "dark"}.png`),
    });
  }
  await panel.getByRole("button", { name: "批准部署" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("部署成功", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(tmpdir(), "larness-ui-f8-completed.png") });
  await page.getByLabel("对话输入").fill("保留当前对话结构");
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  );
  // Resolve the existing theme token through a CSS property, including hex-to-rgb conversion.
  const expected = await page.evaluate((value) => {
    const node = document.createElement("span");
    node.style.color = value;
    document.body.append(node);
    const color = getComputedStyle(node).color;
    node.remove();
    return color;
  }, accent);
  await expect(page.getByRole("button", { name: "发送消息" })).toHaveCSS(
    "background-color",
    expected,
  );
  await expect(page.getByText(/正在执行，可先编辑|工作区上下文/)).toHaveCount(0);
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByRole("button", { name: "停止执行" })).toBeVisible();
  await expect(activity).toBeVisible();
  const process = page.getByRole("button", { name: /执行过程/ }).last();
  await expect(process).toBeVisible();
  await process.click();
  await expect(page.getByRole("button", { name: /计划 ·/ }).last()).toBeVisible();
  await page.getByRole("button", { name: "停止执行" }).click();
  await expect(page.getByRole("button", { name: "发送消息" })).toBeVisible();
  await expect(activity).toHaveCount(0);
  for (const width of [736, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: path.join(tmpdir(), "larness-m2-16-mobile.png") });
});

test("only settled answer markdown uses the themed message bubble", async ({ page }) => {
  await page.goto("/");
  const bubble = page.getByTestId("final-answer-bubble");
  await expect(bubble).toHaveCount(0);
  await page.getByRole("button", { name: "批准部署" }).click();
  await expect(bubble).toContainText("已批准部署");
  await expect(bubble.getByText("部署成功", { exact: true })).toHaveCount(0);
  await expect(bubble.getByRole("button", { name: "复制答复" })).toHaveCount(0);
  await expect(bubble.getByRole("time")).toHaveCount(0);
  await page.getByRole("button", { name: /执行过程/ }).click();
  await expect(page.getByText(/我先检查项目结构/)).toBeVisible();
  await expect(bubble.getByText(/我先检查项目结构/)).toHaveCount(0);
  for (const [theme, surface] of [
    ["浅色", "rgb(255, 255, 255)"],
    ["深色", "rgb(34, 34, 37)"],
  ]) {
    await page.getByRole("button", { name: "外观与主题" }).click();
    await page.getByRole("menuitemradio", { name: theme, exact: false }).click();
    await expect(bubble).toHaveCSS("background-color", surface);
  }
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(bubble).toBeVisible();
  const box = await bubble.boundingBox();
  expect(box && box.x >= 0 && box.x + box.width <= 320).toBeTruthy();
});
