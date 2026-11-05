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
it("expands only one resource section and allows both collapsed", () => {
  render(<ProjectResourceSidebar />);
  const files = screen.getByRole("button", { name: "文件" });
  const git = screen.getByRole("button", { name: "Git" });
  expect(files).toHaveAttribute("aria-expanded", "true");
  expect(git).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(git);
  expect(files).toHaveAttribute("aria-expanded", "false");
  expect(git).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(git);
  expect(git).toHaveAttribute("aria-expanded", "false");
});
