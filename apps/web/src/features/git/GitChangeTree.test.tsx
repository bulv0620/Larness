import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { GitChangeTree } from "./GitChangeTree";

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
it("keeps staged and conflict rows read-only and exposes full rename paths", () => {
  render(
    <GitChangeTree
      changes={[
        { path: "new/a.ts", origPath: "old/a.ts", status: "renamed", staged: true },
        { path: "merge.txt", status: "conflicted", staged: false },
      ]}
      disabled={false}
      onOpen={vi.fn()}
      onStage={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "查看差异 new/a.ts（已暂存）" })).toHaveAttribute(
    "title",
    "old/a.ts → new/a.ts",
  );
  expect(screen.queryByRole("button", { name: /^暂存 / })).toBeNull();
});
