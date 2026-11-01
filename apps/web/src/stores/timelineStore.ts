import type { ApprovalItem, TimelineItem } from "@larness/shared";
import { create } from "zustand";
import { appendAssistantMessage, applyTurnEvent } from "@/lib/timeline";
import { gateway } from "@/mocks/gateway";

let controller: AbortController | null = null;

interface TimelineState {
  sessionId: string;
  items: TimelineItem[];
  loading: boolean;
  isStreaming: boolean;
  load: (sessionId: string) => Promise<void>;
  send: (text: string) => Promise<void>;
  stop: () => void;
  resolveApproval: (approvalId: string, decision: "approve" | "reject") => Promise<void>;
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  sessionId: "ses_1",
  items: [],
  loading: false,
  isStreaming: false,

  load: async (sessionId) => {
    controller?.abort();
    controller = null;
    set({ sessionId, loading: true, isStreaming: false, items: [] });
    try {
      const items = await gateway.timeline(sessionId);
      if (get().sessionId === sessionId) {
        set({ items });
      }
    } finally {
      if (get().sessionId === sessionId) {
        set({ loading: false });
      }
    }
  },

  send: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().isStreaming) return;

    const userItem: TimelineItem = {
      id: uid("msg"),
      kind: "message",
      role: "user",
      text: trimmed,
      createdAt: Date.now(),
    };

    set((state) => ({
      items: [...state.items, userItem],
      isStreaming: true,
    }));

    controller = new AbortController();
    const active = controller;
    const sessionId = get().sessionId;

    try {
      for await (const event of gateway.sendTurn({
        sessionId,
        text: trimmed,
        signal: active.signal,
      })) {
        set((state) => ({ items: applyTurnEvent(state.items, event) }));
      }
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      set((state) => ({
        items: appendAssistantMessage(
          state.items,
          uid("msg"),
          aborted ? "已停止当前执行。" : "执行失败：Mock Provider 连接被中断。",
        ),
      }));
    } finally {
      set((state) => ({
        isStreaming: false,
        items: state.items.map((item) =>
          item.kind === "message" ? { ...item, streaming: false } : item,
        ),
      }));
      if (controller === active) controller = null;
    }
  },

  stop: () => {
    controller?.abort();
    const sessionId = get().sessionId;
    void gateway.cancelTurn(sessionId);
    set({ isStreaming: false });
  },

  resolveApproval: async (approvalId, decision) => {
    const approval = get().items.find(
      (item): item is ApprovalItem => item.kind === "approval" && item.id === approvalId,
    );
    if (!approval) return;
    if (approval.status !== "pending") return;

    set((state) => ({
      items: state.items.map((item) =>
        item.kind === "approval" && item.id === approvalId
          ? { ...item, status: decision === "approve" ? "approved" : "rejected" }
          : item,
      ),
    }));

    await gateway.resolveApproval(approvalId, decision);

    set((state) => {
      const message =
        decision === "approve"
          ? "已批准部署。PM2 正在替换 web-prod，健康检查通过后会写入部署记录。"
          : "已暂不部署。web-prod 保持停止状态，构建产物会保留 24 小时。";
      const items = appendAssistantMessage(state.items, uid("msg"), message);
      if (decision === "approve") {
        items.push({
          id: uid("art"),
          kind: "artifact",
          title: "部署成功",
          description: "web-prod 已在 8080 端口启动，健康检查通过。",
          meta: "PM2 · 2026-10-31 20:45",
          createdAt: Date.now(),
        });
      }
      return {
        items: items.map((item) =>
          item.kind === "plan"
            ? {
                ...item,
                steps: item.steps.map((step) =>
                  step.title.includes("部署") && decision === "approve"
                    ? { ...step, status: "done" as const }
                    : step,
                ),
              }
            : item,
        ),
      };
    });
  },
}));
