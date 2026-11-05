import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { useComposerStore } from "@/stores/composerStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { Welcome } from "./Welcome";

it("fills a suggestion and focuses the composer without sending it", () => {
  useComposerStore.setState({ draft: "" });
  const before = useNavigationStore.getState().focusComposerNonce;
  render(<Welcome />);
  expect(screen.getAllByRole("button")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: /了解这个项目/ }));
  expect(useComposerStore.getState().draft).toContain("项目结构");
  expect(useNavigationStore.getState().focusComposerNonce).toBe(before + 1);
});
