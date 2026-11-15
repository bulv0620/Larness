import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("real Git panel batches a collapsed folder, commits, pushes and pulls without approval", async ({
  page,
}) => {
  test.setTimeout(90000);
  const dir = mkdtempSync(path.join(tmpdir(), "larness-git-ui-"));
  const repo = path.join(dir, "repo");
  const remote = path.join(dir, "remote.git");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "GIT UI");
  git(repo, "config", "user.email", "git-ui@example.com");
  writeFileSync(path.join(repo, "a.txt"), "seed\n");
  git(repo, "add", "a.txt");
  git(repo, "commit", "-q", "-m", "initial");
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
    await page.getByLabel("项目资源", { exact: true }).getByRole("tab", { name: "Git" }).click();
    const gitPanel = page.getByTestId("git-panel");
    await expect(gitPanel.getByText("a.txt").first()).toBeVisible();
    mkdirSync(path.join(repo, "src", "nested"), { recursive: true });
    writeFileSync(path.join(repo, "src", "nested", "中文 空格.txt"), "nested\n");
    writeFileSync(path.join(repo, "src", "nested", "second.txt"), "second\n");
    const folder = gitPanel.getByRole("button", { name: "src/nested", exact: true });
    const folderLabel = folder.getByText("src/nested", { exact: true });
    const rootLabel = gitPanel.getByRole("button", { name: "查看差异 a.txt" }).getByText("a.txt");
    const nestedLabel = gitPanel.getByText("second.txt", { exact: true });
    await expect(nestedLabel).toBeVisible();
    const folderBox = await folderLabel.boundingBox();
    const rootBox = await rootLabel.boundingBox();
    const nestedBox = await nestedLabel.boundingBox();
    expect(folderBox?.x).toBe(rootBox?.x);
    expect(nestedBox?.x).toBe((folderBox?.x ?? 0) + 12);
    await page.screenshot({ path: path.join(tmpdir(), "larness-gx-3-git-indent.png") });
    await folder.click();
    const stageFolder = gitPanel.getByRole("button", { name: "暂存目录 src/nested" });
    await expect(folder).toHaveAttribute("aria-expanded", "false");
    await folder.hover();
    await page.screenshot({ path: path.join(tmpdir(), "larness-gx-2-git.png") });
    await stageFolder.focus();
    await page.keyboard.press("Enter");
    const unstageFolder = gitPanel.getByRole("button", { name: "取消暂存目录 src/nested" });
    await expect(unstageFolder).toBeEnabled();
    expect(git(repo, "diff", "--cached", "--name-only").split("\n")).toHaveLength(2);
    await unstageFolder.click();
    await expect(stageFolder).toBeEnabled();
    await expect(folder).toHaveAttribute("aria-expanded", "false");
    expect(git(repo, "diff", "--cached", "--name-only")).toBe("");
    expect(git(repo, "ls-files", "--others", "--exclude-standard", "--", "src")).toContain(
      "second.txt",
    );

    await gitPanel.getByText("a.txt").first().click();
    const diffWindow = page.getByRole("dialog", { name: "a.txt", exact: true });
    await expect(diffWindow).toContainText("+changed in ui", { timeout: 15000 });
    await diffWindow.getByRole("button", { name: "打开工作区文件" }).click();
    const editor = page.getByRole("textbox", { name: "文件内容" });
    await expect(editor).toBeVisible();
    await expect(page.locator(".view-lines")).toContainText("changed in ui");
    await page
      .getByRole("dialog")
      .filter({ has: editor })
      .getByRole("button", { name: "关闭 a.txt" })
      .click();
    await diffWindow.getByRole("button", { name: "隐藏窗口" }).click();
    await expect(diffWindow).toHaveCount(0);

    const stage = gitPanel.getByRole("button", { name: "暂存 a.txt" });
    const stagePosition = await stage.boundingBox();
    await page.route(
      "**/api/projects/*/git/actions",
      (route) =>
        route.fulfill({
          status: 409,
          json: { error: { code: "RESOURCE_LOCKED", message: "Project is locked" } },
        }),
      { times: 1 },
    );
    await stage.click();
    const failure = page.getByRole("alert").filter({ hasText: /稍后重试/ });
    await expect(failure).toHaveCSS("position", "fixed");
    expect(await stage.boundingBox()).toEqual(stagePosition);
    await failure.getByRole("button", { name: "关闭错误消息" }).click();
    await expect(failure).toHaveCount(0);
    await stage.click();
    await expect(gitPanel.getByRole("button", { name: "取消暂存 a.txt" })).toBeVisible({
      timeout: 15000,
    });
    await page.getByLabel("提交信息").fill("UI commit");
    await page.getByRole("button", { name: /提交已暂存/ }).click();
    await expect(
      gitPanel.getByRole("button", { name: "提交已暂存 (0)", exact: true }),
    ).toBeDisabled({ timeout: 15000 });
    await expect(stageFolder).toBeVisible();
    expect(git(repo, "status", "--short", "--untracked-files=no")).toBe("");
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
    await expect(gitPanel.getByRole("status")).toHaveText("推送完成", { timeout: 15000 });
    await expect(page.getByRole("region", { name: "Git 操作审批" })).toHaveCount(0);
    expect(git(remote, "rev-parse", "main")).toBe(git(repo, "rev-parse", "HEAD"));

    const peer = path.join(dir, "peer");
    git(dir, "clone", "-q", "-b", "main", remote, peer);
    git(peer, "config", "user.name", "GIT UI peer");
    git(peer, "config", "user.email", "git-ui-peer@example.com");
    writeFileSync(path.join(peer, "a.txt"), "changed upstream\n");
    git(peer, "commit", "-qam", "upstream commit");
    git(peer, "push", "-q", "origin", "main");
    await gitPanel.getByRole("button", { name: "拉取（仅快进）" }).click();
    await expect(gitPanel.getByRole("status")).toHaveText("拉取完成", { timeout: 15000 });
    expect(git(repo, "rev-parse", "HEAD")).toBe(git(peer, "rev-parse", "HEAD"));
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
