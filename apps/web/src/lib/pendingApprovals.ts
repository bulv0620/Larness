import type { ApprovalItem, TimelineItem } from "@larness/shared";

export function pendingApprovals(items: TimelineItem[]): ApprovalItem[] {
  const ended = new Set(
    items
      .filter(
        (item) => item.kind === "message" && item.role === "user" && item.turnOutcome !== undefined,
      )
      .map((item) => item.turnId),
  );
  return items.filter(
    (item): item is ApprovalItem =>
      item.kind === "approval" &&
      item.status === "pending" &&
      (item.turnId === undefined || !ended.has(item.turnId)),
  );
}
