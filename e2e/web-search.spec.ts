import { expect, test } from "@playwright/test";

test("replaces the composer context shortcut with an explicit web search globe", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "添加上下文" })).toHaveCount(0);

  const globe = page.getByRole("button", { name: "联网搜索：未配置，点击配置" });
  await expect(globe).toBeVisible();
  await expect(globe).toHaveAttribute("aria-pressed", "false");
});
