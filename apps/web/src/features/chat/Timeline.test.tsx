import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useTimelineStore } from "@/stores/timelineStore";
import { Timeline } from "./Timeline";

beforeEach(() => {
  useTimelineStore.setState({
    items: [],
    loading: false,
    isStreaming: false,
    activeTurnId: null,
  });
});

it("keeps the final answer visible when a completed tool event arrives after the message", () => {
  useTimelineStore.setState({
    items: [
      {
        id: "user",
        kind: "message",
        role: "user",
        text: "list",
        createdAt: 1,
        turnId: "turn-1",
        turnOutcome: "completed",
        durationMs: 10,
      },
      {
        id: "commentary",
        kind: "message",
        role: "assistant",
        text: "我先看一下。",
        createdAt: 2,
        turnId: "turn-1",
      },
      {
        id: "answer",
        kind: "message",
        role: "assistant",
        text: "项目文件已列出。",
        createdAt: 3,
        turnId: "turn-1",
      },
      {
        id: "tool",
        kind: "tool",
        name: "list_files",
        summary: "list .",
        args: "",
        status: "done",
        createdAt: 4,
        turnId: "turn-1",
      },
    ],
  });
  render(<Timeline />);
  expect(screen.getByText("项目文件已列出。")).toBeVisible();
});
