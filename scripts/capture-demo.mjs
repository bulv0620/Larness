import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const baseURL = process.env.DEMO_URL ?? "http://localhost:5173";
const outDir = new URL("../specs/000-visual-demo/screenshots/", import.meta.url);
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const errors = [];

async function shot(name, { width, height, theme, action }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${name}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`${name}: ${message.text()}`);
  });
  if (theme) {
    await page.addInitScript((value) => {
      window.localStorage.setItem("harness.theme", value);
    }, theme);
  }
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  if (action) await action(page);
  await page.screenshot({ path: new URL(name, outDir).pathname });
  await context.close();
}

await shot("01-light-1440.png", { width: 1440, height: 900 });
await shot("02-dark-1440.png", { width: 1440, height: 900, theme: "dark" });
await shot("03-terminal-dark.png", {
  width: 1440,
  height: 900,
  theme: "dark",
  action: async (page) => {
    await page.getByRole("button", { name: "打开终端窗口" }).click();
    await page.waitForTimeout(700);
  },
});
await shot("04-file-light.png", {
  width: 1440,
  height: 900,
  action: async (page) => {
    await page.getByRole("button", { name: "打开文件窗口" }).click();
    await page.locator(".monaco-editor").waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForTimeout(500);
  },
});
await shot("05-browser-dark.png", {
  width: 1440,
  height: 900,
  theme: "dark",
  action: async (page) => {
    await page.getByRole("button", { name: "打开浏览器窗口" }).click();
    await page.waitForTimeout(700);
  },
});
await shot("06-narrow-1100.png", { width: 1100, height: 900 });
await shot("07-files-tab.png", {
  width: 1440,
  height: 900,
  action: async (page) => {
    await page.getByRole("tab", { name: /^文件/ }).click();
    await page.waitForTimeout(400);
  },
});

console.log(JSON.stringify({ out: outDir.pathname, errors }, null, 2));
await browser.close();
