import { expect, test } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`centers new chats and docks the same composer with ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "对话输入" });
    const center = page.getByRole("main");
    const dock = page.getByTestId("composer-dock");
    const backdrop = dock.getByTestId("welcome-backdrop");
    const surface = dock.getByTestId("composer-surface");
    const historyPosition = (await input.boundingBox())?.y ?? 0;
    await expect(dock).toHaveAttribute("data-placement", "bottom");
    await page.getByRole("button", { name: /^新建会话/ }).click();
    await expect(dock).toHaveAttribute("data-placement", "center");
    await expect(center.getByRole("heading", { name: "今天想做什么？" })).toBeVisible();
    await expect(backdrop).toBeVisible();
    await expect(backdrop).toHaveCSS(
      "animation-name",
      reducedMotion === "reduce" ? "none" : "welcome-backdrop-expand",
    );
    await expect(surface).toHaveCSS("backdrop-filter", /blur\(/);
    expect((await input.boundingBox())?.y).toBeLessThan(historyPosition);
    if (reducedMotion === "reduce") {
      await page.setViewportSize({ width: 320, height: 540 });
      await expect(input).toBeVisible();
      expect(
        await center.evaluate((element) => element.scrollWidth - element.clientWidth),
      ).toBeLessThanOrEqual(1);
    }
    await page.getByRole("button", { name: "了解项目", exact: true }).click();
    await expect(input).toHaveValue(/项目结构/);
    await expect(input).toBeFocused();
    const inputNode = await input.elementHandle();
    const durations: number[] = [];
    await page.exposeFunction("recordComposerAnimation", (duration: number) => {
      durations.push(duration);
    });
    await input.evaluate((node) => {
      const composer = node.closest("[data-composer-motion]");
      if (!composer) throw new Error("Missing composer motion element");
      const animate = composer.animate.bind(composer);
      composer.animate = (...args) => {
        const options = args[1];
        const duration = typeof options === "number" ? options : Number(options?.duration);
        void (
          window as Window & { recordComposerAnimation: (ms: number) => Promise<void> }
        ).recordComposerAnimation(duration);
        return animate(...args);
      };
    });
    await input.press("Enter");
    await expect(dock).toHaveAttribute("data-placement", "bottom");
    await expect(backdrop).toHaveCount(0);
    await expect(surface).toHaveCSS("backdrop-filter", "none");
    await expect(center.getByRole("heading", { name: "今天想做什么？" })).toHaveCount(0);
    await expect(center.getByText(/先帮我了解项目结构/)).toBeVisible();
    await expect(input).toBeFocused();
    expect(await inputNode?.evaluate((node) => node === document.activeElement)).toBe(true);
    if (reducedMotion === "no-preference") {
      await expect.poll(() => durations).toEqual([290]);
    } else {
      expect(durations).toEqual([]);
    }
  });
}

test("keeps the circular backdrop centered and the glass composer readable across themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: /^新建会话/ }).click();
  const dock = page.getByTestId("composer-dock");
  const backdrop = dock.getByTestId("welcome-backdrop");
  const surface = dock.getByTestId("composer-surface");
  await expect(backdrop).toBeVisible();
  await expect(backdrop).toHaveCSS("pointer-events", "none");
  for (const height of [900, 440]) {
    await page.setViewportSize({ width: 1440, height });
    const circle = await backdrop.boundingBox();
    const bounds = await dock.boundingBox();
    if (!circle || !bounds) throw new Error("Missing new-chat layout");
    expect(circle.width).toBeCloseTo(circle.height, 0);
    expect(circle.height).toBeLessThanOrEqual(bounds.height);
    expect(circle.x + circle.width / 2).toBeCloseTo(bounds.x + bounds.width / 2, 0);
    expect(circle.y + circle.height / 2).toBeCloseTo(bounds.y + bounds.height / 2, 0);
  }

  const lightSurface = await surface.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  await page.getByRole("button", { name: "外观与主题" }).click();
  await page.getByRole("menuitemradio", { name: "深色", exact: false }).click();
  await expect(surface).not.toHaveCSS("background-color", lightSurface);
  await expect(surface).toHaveCSS("backdrop-filter", /blur\(/);
  const input = page.getByRole("textbox", { name: "对话输入" });
  await input.click();
  await expect(input).toBeFocused();
});
