import type { TimelineItem, TurnEvent } from "@harness/shared";

function upsert(items: TimelineItem[], item: TimelineItem): TimelineItem[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}

export function applyTurnEvent(items: TimelineItem[], event: TurnEvent): TimelineItem[] {
  switch (event.type) {
    case "message.user":
    case "message.assistant":
      return upsert(items, event.item);
    case "message.delta":
      return items.map((item) =>
        item.id === event.id && item.kind === "message"
          ? { ...item, text: `${item.text}${event.text}`, streaming: true }
          : item,
      );
    case "plan":
      return upsert(items, event.item);
    case "tool":
      return upsert(items, event.item);
    case "tool.update":
      return items.map((item) =>
        item.id === event.id && item.kind === "tool" ? { ...item, ...event.patch } : item,
      );
    case "approval":
      return upsert(items, event.item);
    case "approval.update":
      return items.map((item) =>
        item.id === event.id && item.kind === "approval" ? { ...item, status: event.status } : item,
      );
    case "artifact":
    case "error":
      return upsert(items, event.item);
    case "turn.done":
      return items.map((item) => (item.kind === "message" ? { ...item, streaming: false } : item));
    default:
      return items;
  }
}

export function appendAssistantMessage(
  items: TimelineItem[],
  id: string,
  text: string,
): TimelineItem[] {
  return upsert(items, {
    id,
    kind: "message",
    role: "assistant",
    text,
    createdAt: Date.now(),
  });
}
