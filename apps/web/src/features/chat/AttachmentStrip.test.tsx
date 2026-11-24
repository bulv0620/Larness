import type { MessageItem } from "@larness/shared";
import { render, screen } from "@testing-library/react";
import { FileText } from "lucide-react";
import { beforeEach, expect, it } from "vitest";
import { useNavigationStore } from "@/stores/navigationStore";
import { ResultCard } from "./ResultCard";
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

it("renders one adaptive-width tag per attachment below the bubble", () => {
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
  const chip = screen.getByTestId("attachment-chip");
  expect(chip.className).toContain("h-7");
  expect(chip.className).toContain("rounded-full");
  // Width follows the file name: no fixed width, only a cap on the label.
  expect(chip.className).not.toMatch(/(?:^|\s)w-\[/);
  expect(chip.querySelector("button")?.className).toContain("max-w-[180px]");

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

it("shares the artifact tag shape", () => {
  render(
    <ResultCard icon={FileText} label="文件 · a.ts" ariaLabel="打开文件" onClick={() => {}} />,
  );
  const artifact = screen.getByRole("button", { name: "打开文件" });

  render(<MessageBubble item={item({ attachments: [docRef()] })} />);
  const tag = screen.getAllByTestId("attachment-chip").at(-1);
  expect(tag).toBeDefined();

  // One chip shape for attachments and turn artifacts: same height, radius,
  // border/background tokens and text size, so the two never drift apart.
  for (const token of ["h-7", "rounded-full", "border-line/80", "bg-surface-2/55"]) {
    expect(artifact.className).toContain(token);
    expect(tag?.className).toContain(token);
  }
  expect(tag?.className).toContain("text-[11px]");
  // Both sizes are driven by their label, never by a fixed width.
  expect(tag?.className).not.toMatch(/(?:^|\s)w-\[/);
  expect(artifact.className).not.toMatch(/(?:^|\s)w-\[/);
});

it("uses the file tree's Material icon for documents and images", () => {
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

  const chips = screen.getAllByTestId("attachment-chip");
  expect(chips).toHaveLength(2);
  for (const chip of chips) {
    expect(chip.querySelector("span[style*='--file-icon']")).not.toBeNull();
    expect(chip.querySelector("svg.lucide-file-text")).toBeNull();
    expect(chip.querySelector("svg.lucide-image")).toBeNull();
  }
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
