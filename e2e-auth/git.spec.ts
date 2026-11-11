import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { execFileSync } from "./support";

function git(cwd: string, ...args: string[]) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  }).trim();
}

async function pair(page: Page) {
  await page.goto("/pair");
  const panel = page.locator("[data-request-id]");
  await expect(panel).toHaveAttribute("data-stage", "waiting");
  const approved = JSON.parse(
    execFileSync(
      "pnpm",
      [
        "--silent",
        "--filter",
        "@larness/server",
        "exec",
        "tsx",
        "../../scripts/e2e-ipc.ts",
        "approve",
        (await panel.getAttribute("data-request-id")) ?? "",
        "allow_once",
      ],
      { encoding: "utf8" },
    ),
  );
  await page.getByLabel("配对码").fill(approved.code);
  await page.getByRole("button", { name: "兑换配对码" }).click();
  await expect(page.getByTestId("workspace-home")).toBeVisible();
}

test("M2-5b real Git panel shows status, stages, commits, diffs and approves a push", async ({
  page,
}) => {
  test.setTimeout(90000);
  const dir = mkdtempSync(path.join(tmpdir(), "larness-git-ui-"));
  const repo = path.join(dir, "repo");
  const remote = path.join(dir, "remote.git");
  execFileSync("mkdir", ["-p", repo]);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "GIT UI");
  git(repo, "config", "user.email", "git-ui@example.com");
  writeFileSync(path.join(repo, "a.txt"), "seed\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-q", "-m", "initial");
  execFileSync("mkdir", ["-p", remote]);
  git(dir, "init", "-q", "--bare", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "-u", "origin", "main");
  writeFileSync(path.join(repo, "a.txt"), "changed in ui\n");

  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await pair(page);
    await page.getByRole("button", { name: "添加项目" }).click();
    await page.getByLabel("项目目录").fill(repo);
    await page.getByRole("dialog").getByRole("button", { name: "添加项目" }).click();
    await page.getByRole("button", { name: "在 repo 中新建会话" }).click();
    await expect.poll(() => page.getByText("main").count(), { timeout: 15000 }).toBeGreaterThan(0);
    await page
      .getByLabel("项目资源", { exact: true })
      .getByRole("button", { name: /^Git/ })
      .first()
      .click();
    const gitPanel = page.getByTestId("git-panel");
    await expect(gitPanel.getByText("a.txt").first()).toBeVisible();
    await page.screenshot({ path: path.join(tmpdir(), "larness-m2-5b-git.png") });

    await gitPanel.getByText("a.txt").first().click();
    const diffWindow = page.getByRole("dialog", { name: "a.txt", exact: true });
    await expect(diffWindow).toContainText("+changed in ui", { timeout: 15000 });
    await diffWindow.getByRole("button", { name: "隐藏窗口" }).click();
    await expect(diffWindow).toHaveCount(0);

    await gitPanel.getByRole("button", { name: "暂存 a.txt" }).click();
    await expect(gitPanel.getByRole("button", { name: "取消暂存 a.txt" })).toBeVisible({
      timeout: 15000,
    });
    await page.getByLabel("提交信息").fill("UI commit");
    await page.getByRole("button", { name: /提交已暂存/ }).click();
    await expect(page.getByText("工作区干净", { exact: true })).toBeVisible({ timeout: 15000 });
    expect(git(repo, "log", "-1", "--format=%s")).toBe("UI commit");
    expect(git(remote, "rev-parse", "main")).not.toBe(git(repo, "rev-parse", "HEAD"));

    await page.getByRole("button", { name: "管理分支" }).click();
    await page.getByLabel("新分支名").fill("ui-branch");
    await page.getByRole("button", { name: "创建分支" }).click();
    const branchSelect = page.getByRole("button", { name: "切换分支" });
    await expect(branchSelect).toHaveText("ui-branch", { timeout: 15000 });
    await branchSelect.click();
    await page.getByRole("menuitemradio", { name: "main", exact: true }).click();
    await expect(branchSelect).toHaveText("main", { timeout: 15000 });

    await page.getByRole("button", { name: "推送" }).click();
    const approval = page.getByRole("region", { name: "Git 操作审批" });
    await expect(approval).toBeVisible({ timeout: 10000 });
    await expect(approval).toContainText("push");
    await approval.getByRole("button", { name: "批准" }).click();
    await approval.getByRole("button", { name: "执行一次" }).click();
    await expect(approval).toHaveCount(0, { timeout: 15000 });
    expect(git(remote, "rev-parse", "main")).toBe(git(repo, "rev-parse", "HEAD"));
  } finally {
    await page.evaluate(async (rootPath) => {
      const response = await fetch("/api/auth/session");
      if (!response.ok) return;
      const session = (await response.json()) as { csrfToken: string };
      const { projects } = (await (await fetch("/api/projects")).json()) as {
        projects: { id: string; rootPath: string; realPath: string }[];
      };
      const project = projects.find(
        (item) => item.rootPath === rootPath || item.realPath === rootPath,
      );
      if (project) {
        await fetch(`/api/projects/${project.id}`, {
          method: "DELETE",
          headers: { "x-csrf-token": session.csrfToken },
        });
      }
    }, repo);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
