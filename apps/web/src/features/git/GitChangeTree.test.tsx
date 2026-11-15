import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GitChangeTree } from "./GitChangeTree";

it("stages only eligible paths under a collapsed folder and restores its collapse state", () => {
  const onStageFolder = vi.fn();
  const changes = [
    { path: "src/中文 空格.txt", status: "modified", staged: false },
    { path: "src/nested/deleted.txt", status: "deleted", staged: false },
    { path: "src/conflict.txt", status: "conflicted", staged: false },
    { path: "src-other/keep.txt", status: "modified", staged: false },
  ];
  const props = {
    disabled: false,
    onOpen: vi.fn(),
    onStage: vi.fn(),
    onUnstage: vi.fn(),
    onDiscard: vi.fn(),
    onStageFolder,
    onUnstageFolder: vi.fn(),
  };
  const { rerender } = render(<GitChangeTree {...props} changes={changes} />);
  const folder = screen.getByRole("button", { name: "src" });
  fireEvent.click(folder);
  const button = screen.getByRole("button", { name: "暂存目录 src" });
  expect(button).toHaveAttribute("title", "暂存此目录下 2 个文件");
  fireEvent.click(button);
  expect(onStageFolder).toHaveBeenCalledExactlyOnceWith([
    "src/中文 空格.txt",
    "src/nested/deleted.txt",
  ]);
  expect(folder).toHaveAttribute("aria-expanded", "false");
  rerender(<GitChangeTree {...props} changes={[]} />);
  rerender(<GitChangeTree {...props} changes={changes} />);
  expect(screen.getByRole("button", { name: "src" })).toHaveAttribute("aria-expanded", "false");
});

it("offers discard on worktree rows and unstage on staged rows", () => {
  const discard = vi.fn(),
    unstage = vi.fn();
  render(
    <GitChangeTree
      changes={[
        { path: "a.txt", status: "modified", staged: false },
        { path: "b.txt", status: "added", staged: true },
      ]}
      disabled={false}
      onOpen={vi.fn()}
      onStage={vi.fn()}
      onStageFolder={vi.fn()}
      onUnstageFolder={vi.fn()}
      onDiscard={discard}
      onUnstage={unstage}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "放弃更改 a.txt" }));
  expect(discard).toHaveBeenCalledWith(expect.objectContaining({ path: "a.txt" }));
  fireEvent.click(screen.getByRole("button", { name: "取消暂存 b.txt" }));
  expect(unstage).toHaveBeenCalledExactlyOnceWith("b.txt");
});

it("compacts directory chains while preserving exact paths and diff targets", () => {
  const onOpen = vi.fn(),
    onStage = vi.fn();
  render(
    <GitChangeTree
      changes={[
        { path: "apps/web/src/a.ts", status: "modified", staged: false },
        { path: "apps/web/src/deleted.ts", status: "deleted", staged: false },
      ]}
      disabled={false}
      onOpen={onOpen}
      onStage={onStage}
      onStageFolder={vi.fn()}
      onUnstageFolder={vi.fn()}
      onUnstage={vi.fn()}
      onDiscard={vi.fn()}
    />,
  );
  expect(screen.getByText("apps/web/src")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "查看差异 apps/web/src/a.ts" }));
  expect(onOpen).toHaveBeenCalledWith(
    expect.objectContaining({ path: "apps/web/src/a.ts", staged: false }),
  );
  fireEvent.click(screen.getByRole("button", { name: "暂存 apps/web/src/deleted.ts" }));
  expect(onStage).toHaveBeenCalledExactlyOnceWith("apps/web/src/deleted.ts");
});
it("keeps conflict rows read-only and offers staged actions and exposes full rename paths", () => {
  render(
    <GitChangeTree
      changes={[
        { path: "new/a.ts", origPath: "old/a.ts", status: "renamed", staged: true },
        { path: "merge.txt", status: "conflicted", staged: false },
      ]}
      disabled={false}
      onOpen={vi.fn()}
      onStage={vi.fn()}
      onStageFolder={vi.fn()}
      onUnstageFolder={vi.fn()}
      onUnstage={vi.fn()}
      onDiscard={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "查看差异 new/a.ts（已暂存）" })).toHaveAttribute(
    "title",
    "old/a.ts → new/a.ts",
  );
  expect(screen.queryByRole("button", { name: /^暂存 / })).toBeNull();
});
