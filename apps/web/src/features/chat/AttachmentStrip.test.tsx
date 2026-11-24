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

const docId = "att_11111111-1111-4111-8111-111111111111";
const imageId = "att_22222222-2222-4222-8222-222222222222";

function docRef(overrides: Record<string, unknown> = {}) {
  return {
    id: docId,
    filename: "spec.docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document" as const,
    sizeBytes: 1200,
    status: "ready" as const,
    method: "native" as const,
    pageCount: 12,
    ...overrides,
  };
}

it("renders one fixed-width tag per attachment below the bubble", () => {
  const { container } = render(
    <MessageBubble
      item={item({
        text: "总结这份文档",
        attachments: [docRef()],
      })}
    />,
  );

  expect(screen.getByTestId("attachment-strip")).toBeInTheDocument();
  expect(screen.getByText("spec.docx")).toBeInTheDocument();
  expect(screen.getByText(/12 页/)).toBeInTheDocument();
  expect(screen.getByTestId("attachment-chip").className).toContain("w-[172px]");

  // The bubble comes first, the tags sit underneath it.
  const surface = container.firstElementChild;
  expect(surface?.children).toHaveLength(2);
  expect(surface?.children[0]?.className).toContain("bg-accent-soft");
  expect(surface?.children[1]?.getAttribute("data-testid")).toBe("attachment-strip");
});

it("omits an empty bubble when only attachments remain", () => {
  const { container } = render(<MessageBubble item={item({ attachments: [docRef()] })} />);

  expect(container.querySelector(".bg-accent-soft")).toBeNull();
  expect(screen.getByTestId("attachment-strip")).toBeInTheDocument();
});

it("shows images as tags instead of inline thumbnails", () => {
  render(
    <MessageBubble
      item={item({
        attachments: [
          docRef(),
          {
            id: imageId,
            filename: "用户截图.png",
            mime: "image/png",
            kind: "image" as const,
            sizeBytes: 100,
            status: "ready" as const,
            method: "none" as const,
            pageCount: null,
          },
        ],
      })}
    />,
  );

  const strip = screen.getByTestId("attachment-strip");
  expect(strip.querySelectorAll("img")).toHaveLength(0);
  expect(screen.getAllByTestId("attachment-chip")).toHaveLength(2);
  expect(screen.getByText("用户截图.png")).toBeInTheDocument();
});

it("does not paint legacy screenshots when attachment refs exist", () => {
  render(
    <MessageBubble
      item={item({
        text: "帮我整理一下这个看板文档的需求",
        attachments: [docRef()],
        screenshots: { sessionId, ids: [docId] },
      })}
    />,
  );

  expect(screen.queryByAltText("用户截图")).toBeNull();
  expect(screen.getByTestId("attachment-strip")).toBeInTheDocument();
});

it("keeps inline screenshots for pre-088 events without refs", () => {
  render(
    <MessageBubble item={item({ text: "看这个", screenshots: { sessionId, ids: [imageId] } })} />,
  );

  expect(screen.getByAltText("用户截图")).toBeInTheDocument();
  expect(screen.queryByTestId("attachment-strip")).toBeNull();
});
