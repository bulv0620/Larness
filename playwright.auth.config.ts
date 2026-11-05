import { defineConfig, devices } from "@playwright/test";

const webPort = Number(process.env.LARNESS_E2E_WEB_PORT ?? 5173);
const serverPort = Number(process.env.LARNESS_E2E_PORT ?? 3210);
const webUrl = `http://localhost:${webPort}`;

export default defineConfig({
  testDir: "./e2e-auth",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: webUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `pnpm --filter @larness/web exec vite --port ${webPort} --strictPort`,
      url: webUrl,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { LARNESS_API_URL: `http://127.0.0.1:${serverPort}` },
    },
    {
      command: "pnpm --filter @larness/server exec tsx ../../scripts/e2e-server.ts",
      url: `http://127.0.0.1:${serverPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        LARNESS_E2E_PORT: String(serverPort),
        LARNESS_E2E_PUBLIC_URL: webUrl,
        LARNESS_E2E_PREVIEW_PORT: process.env.LARNESS_E2E_PREVIEW_PORT ?? "3211",
      },
    },
  ],
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
