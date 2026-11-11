import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProjectResourceSidebar } from "./ProjectResourceSidebar";

vi.mock("@/lib/queries", () => ({
  useSnapshot: () => ({ data: { projects: [], sessions: [], gitChanges: [] } }),
}));
vi.mock("@/components/sections/FileTreePanel", () => ({
  FileTreePanel: () => <span>file body</span>,
}));
vi.mock("@/components/sections/GitPanel", () => ({ GitPanel: () => <span>git body</span> }));

function panel(id: "files" | "git"): HTMLElement {
  const panel = document.getElementById(`resource-${id}`);
  if (!panel) throw new Error(`Missing resource-${id} panel`);
  return panel;
}

it("renders resource tabs with files active and no section header row", () => {
  render(<ProjectResourceSidebar />);
  expect(screen.queryByText("项目资源")).toBeNull();
  expect(screen.getByRole("tab", { name: /^文件/ })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: /^Git/ })).toHaveAttribute("aria-selected", "false");
  expect(screen.getByRole("tabpanel", { name: /^文件/ })).toBeVisible();
  expect(panel("files")).toHaveAttribute("aria-labelledby", "resource-tab-files");
  expect(panel("git")).not.toBeVisible();
  expect(screen.getByText("file body")).toBeVisible();
  expect(screen.getByText("git body")).not.toBeVisible();
});

it("switches the visible panel by tab and keeps both panels mounted", () => {
  render(<ProjectResourceSidebar />);
  const files = screen.getByRole("tab", { name: /^文件/ });
  const git = screen.getByRole("tab", { name: /^Git/ });
  fireEvent.mouseDown(git);
  expect(git).toHaveAttribute("aria-selected", "true");
  expect(files).toHaveAttribute("aria-selected", "false");
  expect(screen.getByRole("tabpanel", { name: /^Git/ })).toBeVisible();
  expect(panel("files")).not.toBeVisible();
  expect(screen.getByText("git body")).toBeVisible();
  expect(screen.getByText("file body")).toBeInTheDocument();

  fireEvent.mouseDown(files);
  expect(screen.getByRole("tabpanel", { name: /^文件/ })).toBeVisible();
  expect(panel("git")).not.toBeVisible();
  expect(screen.getByText("git body")).toBeInTheDocument();
});

it("activates a tab with the keyboard", () => {
  render(<ProjectResourceSidebar />);
  fireEvent.keyDown(screen.getByRole("tab", { name: /^Git/ }), { key: " " });
  expect(screen.getByRole("tab", { name: /^Git/ })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel", { name: /^Git/ })).toBeVisible();
  expect(panel("files")).not.toBeVisible();
});
