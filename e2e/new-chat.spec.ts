import { expect, test } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`centers new chats and docks the same composer with ${reducedMotion}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    await page.goto("/");
    const input = page.getByRole("textbox", { name: "对话输入" });
    const center = page.getByRole("main");
    const dock = page.getByTestId("composer-dock");
    const historyPosition = (await input.boundingBox())?.y ?? 0;
    await expect(dock).toHaveAttribute("data-placement", "bottom");
    await page.getByRole("button", { name: /^新建会话/ }).click();
    await expect(dock).toHaveAttribute("data-placement", "center");
    await expect(center.getByRole("heading", { name: "今天想做什么？" })).toBeVisible();
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
