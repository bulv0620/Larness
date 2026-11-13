import { expect, test } from "@playwright/test";

test("shows the wave before scripts and through the initial authentication checks", async ({
  page,
}) => {
  const scripts = Promise.withResolvers<void>();
  const bootstrap = Promise.withResolvers<void>();
  const session = Promise.withResolvers<void>();

  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") await scripts.promise;
    await route.continue();
  });
  await page.route("**/api/bootstrap", async (route) => {
    await bootstrap.promise;
    await route.continue();
  });
  await page.route("**/api/auth/session", async (route) => {
    await session.promise;
    await route.continue();
  });

  const wordmark = page.getByText("LARNESS", { exact: true });

  try {
    await page.goto("/", { waitUntil: "commit" });
    await expect(wordmark).toBeVisible();
    await expect(wordmark).toHaveCSS("background-clip", /^text(?:, text)*$/);
    expect(await wordmark.evaluate((element) => element.getAnimations().length)).toBeGreaterThan(0);

    const bootstrapRequest = page.waitForRequest("**/api/bootstrap");
    scripts.resolve();
    await bootstrapRequest;
    await expect(wordmark).toBeVisible();

    const sessionRequest = page.waitForRequest("**/api/auth/session");
    bootstrap.resolve();
    await sessionRequest;
    await expect(wordmark).toBeVisible();

    session.resolve();
    await expect(page).toHaveURL(/\/(pair|login)(\?|$)/);
    await expect(wordmark).toBeHidden();
  } finally {
    scripts.resolve();
    bootstrap.resolve();
    session.resolve();
  }
});

test("honors dark theme and reduced motion, then exposes bootstrap retry", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("larness.theme", "system"));

  const failBootstrap = Promise.withResolvers<void>();
  await page.route(
    "**/api/bootstrap",
    async (route) => {
      await failBootstrap.promise;
      await route.abort("failed");
    },
    { times: 1 },
  );

  const wordmark = page.getByText("LARNESS", { exact: true });
  try {
    const bootstrapRequest = page.waitForRequest("**/api/bootstrap");
    await page.goto("/", { waitUntil: "commit" });
    await bootstrapRequest;
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(wordmark).toBeVisible();
    await expect(wordmark).toHaveCSS("animation-name", "none");
    const bounds = await wordmark.boundingBox();
    expect(bounds?.x).toBeGreaterThan(0);
    expect(bounds ? bounds.x + bounds.width : Infinity).toBeLessThan(320);

    failBootstrap.resolve();
    await expect(page.getByRole("heading", { name: "无法连接本机服务" })).toBeVisible();
    await expect(wordmark).toBeHidden();
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await expect(page).toHaveURL(/\/(pair|login)(\?|$)/);
    await expect(wordmark).toBeHidden();
  } finally {
    failBootstrap.resolve();
  }
});

test("offers a reload when the main application module fails to load", async ({ page }) => {
  const mainModule = /\/(assets\/main-[^/]+\.js|src\/main\.tsx)(\?.*)?$/;
  await page.route(mainModule, (route) => route.abort());

  await page.goto("/");
  await expect(page.getByRole("alert")).toHaveText("页面加载失败，请重新加载。");
  await page.unroute(mainModule);
  await page.getByRole("link", { name: "重新加载" }).click();
  await expect(page).toHaveURL(/\/(pair|login)(\?|$)/);
  await expect(page.getByText("LARNESS", { exact: true })).toBeHidden();
});
