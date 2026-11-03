import type { ToolItem } from "@larness/shared";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Timeline } from "@/features/chat/Timeline";
import { useNavigationStore } from "@/stores/navigationStore";
import { useTimelineStore } from "@/stores/timelineStore";

it.each([1, 2])("shows file targets with %i tools without expanding tool details", (count) => {
  const tool: ToolItem = {
    id: "tool-1",
    kind: "tool",
    name: "apply_patch",
    summary: "changed",
    args: "",
    status: "done",
    createdAt: 0,
    resourceTarget: { kind: "file", scope: { projectId: "p" }, path: "note.txt" },
  };
  useNavigationStore.setState({ sessionId: "session" });
  useTimelineStore.setState({
    items: [tool, ...(count === 2 ? [{ ...tool, id: "tool-2", resourceTarget: undefined }] : [])],
    loading: false,
    isStreaming: false,
  });
  render(<Timeline />);
  expect(screen.getByRole("button", { name: "查看文件 · note.txt" })).toBeVisible();
});
