import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.LARNESS_E2E_WEB_PORT ?? 5173);
const webUrl = `http://localhost:${webPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: webUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm --filter @larness/web exec vite --port ${webPort} --strictPort`,
    env: { VITE_USE_MOCKS: "1" },
    url: webUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
