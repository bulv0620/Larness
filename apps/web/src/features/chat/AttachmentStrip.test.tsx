import type { MessageItem } from "@larness/shared";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { useNavigationStore } from "@/stores/navigationStore";
import { MessageBubble } from "./TimelineItemView";

const sessionId = "ses_11111111-1111-4111-8111-111111111111";

function item(overrides: Partial<MessageItem> = {}): MessageItem {
  return {
    id: "msg_1",
    kind: "message",
    role: "user",
    text: "",
    createdAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  useNavigationStore.setState({ sessionId });
});

it("renders attachments outside the text bubble and omits an empty bubble", () => {
  const { container } = render(
    <MessageBubble
      item={item({
        attachments: [
          {
            id: "att_11111111-1111-4111-8111-111111111111",
            filename: "spec.docx",
            mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            kind: "document",
            sizeBytes: 1200,
            status: "ready",
            method: "native",
            pageCount: 12,
          },
        ],
      })}
    />,
  );

  expect(screen.getByTestId("attachment-strip")).toBeInTheDocument();
  expect(screen.getByText("spec.docx")).toBeInTheDocument();
  expect(screen.getByText(/12 页/)).toBeInTheDocument();
  expect(container.querySelector(".bg-accent-soft")).toBeNull();
});

it("keeps the text bubble as a sibling of the attachment strip", () => {
  const { container } = render(
    <MessageBubble
      item={item({
        text: "总结这份文档",
        attachments: [
          {
            id: "att_22222222-2222-4222-8222-222222222222",
            filename: "notes.txt",
            mime: "text/plain",
            kind: "document",
            sizeBytes: 10,
            status: "ready",
            method: "native",
          },
        ],
      })}
    />,
  );

  const surface = container.firstElementChild;
  expect(surface?.children).toHaveLength(2);
  expect(screen.getByText("总结这份文档")).toBeInTheDocument();
  expect(screen.getByTestId("attachment-strip")).toBeInTheDocument();
});
