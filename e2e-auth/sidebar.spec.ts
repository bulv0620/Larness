import { expect, test } from "@playwright/test";
import { execFileSync } from "./support";

test("项目会话独立显示后台任务，并按需展开历史", async ({ page }) => {
  await page.goto("/pair");
  const pairPanel = page.locator("[data-request-id]");
  await expect(pairPanel).toHaveAttribute("data-stage", "waiting");
  const requestId = await pairPanel.getAttribute("data-request-id");
  expect(requestId).toBeTruthy();
  const approval = execFileSync(
    "pnpm",
    [
      "--silent",
      "--filter",
      "@larness/server",
      "exec",
      "tsx",
      "../../scripts/e2e-ipc.ts",
      "approve",
      requestId ?? "",
      "allow_once",
    ],
    { encoding: "utf8" },
  );
  const { code } = JSON.parse(approval) as { code: string };
  await page.getByLabel("配对码").fill(code);
  await page.getByRole("button", { name: "兑换配对码" }).click();
  await expect(page.getByTestId("workspace-home")).toBeVisible();

  const session = await page.request.get("/api/auth/session");
  expect(session.ok()).toBe(true);
  const { csrfToken } = (await session.json()) as { csrfToken: string };
  const headers = { origin: new URL(page.url()).origin, "x-csrf-token": csrfToken };
  const ids: string[] = [];
  for (let number = 1; number <= 7; number++) {
    const created = await page.request.post("/api/sessions", {
      headers,
      data: { title: `侧栏会话 ${number}` },
    });
    expect(created.status()).toBe(201);
    ids.push(((await created.json()) as { id: string }).id);
  }
  await page.reload();
  const project = page.locator('[data-project-id="prj_default"]');
  const rows = project.getByRole("button", { name: /^侧栏会话 / });
  const oldest = project.getByRole("button", { name: "侧栏会话 1", exact: true });
  const backgroundRow = project.getByRole("button", { name: "侧栏会话 6", exact: true });
  const newest = project.getByRole("button", { name: "侧栏会话 7", exact: true });
  const search = page.getByRole("textbox", { name: "搜索项目或会话" });

  await newest.click();
  await expect(rows).toHaveCount(5);
  await expect(oldest).toHaveCount(0);
  await expect(newest).toHaveAttribute("aria-current", "true");
  await expect(newest.locator(".bg-accent")).toBeVisible();

  await search.fill("侧栏会话 1");
  await expect(rows).toHaveCount(1);
  await expect(oldest).toBeVisible();
  await search.clear();
  await project.getByRole("button", { name: "展开更多" }).click();
  await expect(rows).toHaveCount(7);
  await oldest.click();
  await project.getByRole("button", { name: "收起" }).click();
  await expect(rows).toHaveCount(5);
  await expect(oldest).toHaveAttribute("aria-current", "true");
  await expect(backgroundRow.locator(".bg-ink-3")).toBeVisible();

  const background = await page.request.post(`/api/sessions/${ids[5]}/turns`, {
    headers,
    data: { input: "cancel" },
  });
  expect(background.status()).toBe(202);
  await expect(backgroundRow).toHaveAttribute("aria-busy", "true");
  await expect(backgroundRow.locator(".animate-spin")).toBeVisible();
  await expect(oldest.locator(".bg-accent")).toBeVisible();
  await page.reload();
  await expect(backgroundRow.locator(".animate-spin")).toBeVisible();
  await expect(oldest.locator(".bg-accent")).toBeVisible();
  const { turnId } = (await background.json()) as { turnId: string };
  const stopped = await page.request.post(`/api/turns/${turnId}/cancel`, { headers, data: {} });
  expect(stopped.ok()).toBe(true);
  await expect(backgroundRow.locator(".bg-ink-3")).toBeVisible();
  await expect(backgroundRow).toHaveAttribute("aria-busy", "false");
  await backgroundRow.click();
  await expect(backgroundRow.locator(".bg-accent")).toBeVisible();
});
