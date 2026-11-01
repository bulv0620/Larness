import type {
  ApprovalItem,
  ArtifactItem,
  ErrorItem,
  MessageItem,
  PlanItem,
  ServerEvent,
  TimelineItem,
  ToolItem,
} from "@larness/shared";

type Payload = Record<string, unknown>;

function payload(event: ServerEvent): Payload {
  return (event.payload ?? {}) as Payload;
}

function stringField(source: Payload, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function numberField(source: Payload, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" ? value : undefined;
}

function upsert(items: TimelineItem[], item: TimelineItem): TimelineItem[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);

  if (index === -1) {
    return [...items, item];
  }

  const next = [...items];
  next[index] = item;
  return next;
}

function patchTool(items: TimelineItem[], id: string, patch: Partial<ToolItem>): TimelineItem[] {
  return items.map((item) =>
    item.kind === "tool" && item.id === id ? { ...item, ...patch } : item,
  );
}

function patchApproval(
  items: TimelineItem[],
  id: string,
  status: ApprovalItem["status"],
): TimelineItem[] {
  return items.map((item) =>
    item.kind === "approval" && item.id === id ? { ...item, status } : item,
  );
}

function toolId(event: ServerEvent, source: Payload): string {
  return stringField(source, "toolCallId") ?? `${event.eventId}_tool`;
}

export function applyAssistantDelta(
  items: TimelineItem[],
  delta: { messageId: string; text: string; createdAt: number },
): TimelineItem[] {
  const existing = items.find(
    (item): item is MessageItem => item.kind === "message" && item.id === delta.messageId,
  );

  return upsert(items, {
    id: delta.messageId,
    kind: "message",
    role: "assistant",
    text: `${existing?.text ?? ""}${delta.text}`,
    createdAt: existing?.createdAt ?? delta.createdAt,
    streaming: true,
  });
}

export function applyServerEvent(items: TimelineItem[], event: ServerEvent): TimelineItem[] {
  const data = payload(event);
  const turnId = stringField(data, "turnId") ?? event.eventId;

  switch (event.type) {
    case "user.message": {
      const text = stringField(data, "text") ?? "";
      const withoutOptimistic = items.filter((item) => !item.id.startsWith("optimistic_user_"));
      return upsert(withoutOptimistic, {
        id: `msg_${turnId}_user`,
        kind: "message",
        role: "user",
        text,
        createdAt: event.timestamp,
      });
    }
    case "assistant.message": {
      const text = stringField(data, "text") ?? "";
      const messageId = stringField(data, "messageId") ?? `msg_${turnId}_assistant`;
      const message: MessageItem = {
        id: messageId,
        kind: "message",
        role: "assistant",
        text,
        createdAt: event.timestamp,
      };
      return upsert(items, message);
    }
    case "assistant.delta": {
      const delta = stringField(data, "text") ?? "";
      const messageId = stringField(data, "messageId") ?? `msg_${turnId}_assistant`;
      return applyAssistantDelta(items, {
        messageId,
        text: delta,
        createdAt: event.timestamp,
      });
    }
    case "tool.requested": {
      const tool: ToolItem = {
        id: toolId(event, data),
        kind: "tool",
        name: stringField(data, "name") ?? "tool",
        summary: stringField(data, "argsSummary") ?? "",
        args: "",
        status: "running",
        createdAt: event.timestamp,
      };
      return upsert(items, tool);
    }
    case "tool.started": {
      const id = toolId(event, data);
      return items.some((item) => item.kind === "tool" && item.id === id)
        ? patchTool(items, id, { status: "running" })
        : upsert(items, {
            id,
            kind: "tool",
            name: stringField(data, "name") ?? "tool",
            summary: "",
            args: "",
            status: "running",
            createdAt: event.timestamp,
          });
    }
    case "tool.completed": {
      const id = toolId(event, data);
      return patchTool(items, id, {
        status: "done",
        output: stringField(data, "resultSummary") ?? "",
      });
    }
    case "tool.failed": {
      const id = toolId(event, data);
      const output = `${stringField(data, "errorCode") ?? "TOOL_ERROR"}: ${
        stringField(data, "message") ?? "tool failed"
      }`;
      return patchTool(items, id, { status: "error", output });
    }
    case "file.changed": {
      const path = stringField(data, "path") ?? "file";
      const version = stringField(data, "version") ?? "";
      const artifact: ArtifactItem = {
        id: `file_${path}_${version}`,
        kind: "artifact",
        title: `已修改 ${path}`,
        description: `文件变更 · ${stringField(data, "changeType") ?? "modified"}`,
        meta: version.slice(0, 12),
        createdAt: event.timestamp,
      };
      return upsert(items, artifact);
    }
    case "tool.approval.required": {
      const approval: ApprovalItem = {
        id: stringField(data, "approvalId") ?? `approval_${event.eventId}`,
        kind: "approval",
        toolName: stringField(data, "toolName"),
        summary: stringField(data, "summary"),
        risk: stringField(data, "risk"),
        scope: data.scope,
        expiresAt: numberField(data, "expiresAt"),
        status: "pending",
        createdAt: event.timestamp,
      };
      return upsert(items, approval);
    }
    case "tool.approval.resolved": {
      const id = stringField(data, "approvalId") ?? "";
      const decision = stringField(data, "decision");
      const status: ApprovalItem["status"] = decision === "approved" ? "approved" : "rejected";
      return items.some((item) => item.kind === "approval" && item.id === id)
        ? patchApproval(items, id, status)
        : items;
    }
    case "plan.updated": {
      const plan = data.plan as PlanItem | undefined;
      return plan === undefined ? items : upsert(items, plan);
    }
    case "artifact.created": {
      const artifact = data.artifact as ArtifactItem | undefined;
      return artifact === undefined ? items : upsert(items, artifact);
    }
    case "turn.failed": {
      const error: ErrorItem = {
        id: `error_${turnId}`,
        kind: "error",
        message: `${stringField(data, "errorCode") ?? "INTERNAL"}: ${
          stringField(data, "message") ?? "执行失败"
        }`,
        createdAt: event.timestamp,
      };
      return upsert(items, error);
    }
    case "turn.interrupted": {
      return upsert(items, {
        id: `interrupted_${turnId}`,
        kind: "error",
        message: "执行已中断，请重新发送任务。",
        createdAt: event.timestamp,
      });
    }
    case "turn.cancelled": {
      return upsert(items, {
        id: `cancelled_${turnId}`,
        kind: "error",
        message: "已停止当前执行。",
        createdAt: event.timestamp,
      });
    }
    default:
      return items;
  }
}

export function eventsToTimeline(events: ServerEvent[]): TimelineItem[] {
  return events.reduce<TimelineItem[]>((items, event) => applyServerEvent(items, event), []);
}

export function isTerminalTurnEvent(event: ServerEvent): boolean {
  return (
    event.type === "turn.completed" ||
    event.type === "turn.failed" ||
    event.type === "turn.cancelled" ||
    event.type === "turn.interrupted"
  );
}

export function eventTurnId(event: ServerEvent): string | null {
  return stringField(payload(event), "turnId") ?? null;
}
