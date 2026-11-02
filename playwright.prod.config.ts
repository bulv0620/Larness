import { defineConfig, devices } from "@playwright/test";

const serverPort = Number(process.env.LARNESS_E2E_PORT ?? 3210);
const serverUrl = `http://localhost:${serverPort}`;

export default defineConfig({
  testDir: "./e2e-auth",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: serverUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm --filter @larness/server exec tsx ../../scripts/e2e-server.ts",
    url: `http://127.0.0.1:${serverPort}/api/health`,
    env: { LARNESS_E2E_PORT: String(serverPort), LARNESS_E2E_PUBLIC_URL: serverUrl },
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
