import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";

test.setTimeout(60_000);

interface IpcResult {
  code?: string;
  devices?: Array<{ id: string; label: string }>;
  ok?: boolean;
}

function ipc(command: string, ...args: string[]): IpcResult {
  const output = execFileSync(
    "pnpm",
    [
      "--silent",
      "--filter",
      "@larness/server",
      "exec",
      "tsx",
      "../../scripts/e2e-ipc.ts",
      command,
      ...args,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  return JSON.parse(output.trim()) as IpcResult;
}

test("pair, register a passkey, log in, and get logged out after revocation", async ({
  page,
  context,
  request,
}) => {
  await expect
    .poll(
      async () => {
        const response = await request.get("/api/bootstrap");
        const body = (await response.json()) as { initialized?: boolean };
        return body.initialized;
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto("/");
  await expect(page).toHaveURL(/\/pair$/);

  const pairPanel = page.locator("[data-request-id]");
  await expect(pairPanel).toHaveAttribute("data-stage", "waiting", { timeout: 10_000 });

  const requestId = await pairPanel.getAttribute("data-request-id");
  expect(requestId).toBeTruthy();

  const approved = ipc("approve", requestId ?? "", "trust");
  expect(approved.code).toBeTruthy();

  const codeInput = page.getByLabel("配对码");
  await expect(codeInput).toBeVisible({ timeout: 10_000 });
  await codeInput.fill(approved.code ?? "");
  await page.getByRole("button", { name: "兑换配对码" }).click();

  const createPasskey = page.getByRole("button", { name: "创建 Passkey" });
  await expect(createPasskey).toBeEnabled({ timeout: 10_000 });
  await createPasskey.click();

  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByTestId("workspace-home")).toBeVisible();
  await expect(page.getByText("可信设备 · Passkey").first()).toBeVisible();

  await page.getByTestId("logout-button").click();
  await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 10_000 });

  const loginButton = page.getByRole("button", { name: "使用 Passkey 登录" });
  await expect(loginButton).toBeEnabled({ timeout: 10_000 });
  await loginButton.click();

  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByTestId("workspace-home")).toBeVisible();

  const devices = ipc("devices");
  const deviceId = devices.devices?.[0]?.id;
  expect(deviceId).toBeTruthy();
  ipc("revoke", deviceId ?? "");

  await expect(page).toHaveURL(/\/login(\?|$)/, { timeout: 10_000 });

  const storageKeys = await page.evaluate(() => Object.keys(localStorage));
  expect(storageKeys.join(",")).not.toContain("larness_session");
  expect(pageErrors).toEqual([]);
  expect(authenticatorId).toBeTruthy();
});
