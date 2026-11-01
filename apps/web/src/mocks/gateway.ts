import type {
  Gateway,
  GatewaySnapshot,
  MessageItem,
  PlanItem,
  SendTurnInput,
  TimelineItem,
  ToolItem,
  TurnEvent,
} from "@larness/shared";
import { initialTimeline, snapshot } from "./fixtures";

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function assistantMessage(id: string, text: string): MessageItem {
  return { id, kind: "message", role: "assistant", text, createdAt: Date.now(), streaming: true };
}

export class MockGateway implements Gateway {
  async snapshot(): Promise<GatewaySnapshot> {
    await Promise.resolve();
    return structuredClone(snapshot);
  }

  async timeline(sessionId: string): Promise<TimelineItem[]> {
    await Promise.resolve();
    return sessionId === "ses_1" ? structuredClone(initialTimeline) : [];
  }

  async *sendTurn({ text, signal }: SendTurnInput): AsyncIterable<TurnEvent> {
    const planId = uid("plan");
    const plan: PlanItem = {
      id: planId,
      kind: "plan",
      title: "执行计划",
      createdAt: Date.now(),
      steps: [
        { id: "p1", title: "确认当前会话与项目状态", status: "running" },
        { id: "p2", title: "更新工作台并启动开发服务", status: "pending" },
        { id: "p3", title: "验证预览地址与日志", status: "pending" },
      ],
    };

    await wait(420, signal);
    yield { type: "plan", item: plan };

    await wait(520, signal);
    yield {
      type: "plan",
      item: {
        ...plan,
        steps: [
          { id: "p1", title: "确认当前会话与项目状态", status: "done" },
          { id: "p2", title: "更新工作台并启动开发服务", status: "running" },
          { id: "p3", title: "验证预览地址与日志", status: "pending" },
        ],
      },
    };

    const intro = assistantMessage(uid("msg"), "");
    yield { type: "message.assistant", item: intro };
    for (const chunk of [
      "收到。",
      `我会在 **${text.slice(0, 24)}** 这个任务上继续，`,
      "先读取项目脚本和现有端口，再启动开发服务。",
    ]) {
      await wait(160, signal);
      yield { type: "message.delta", id: intro.id, text: chunk };
    }

    const readTool: ToolItem = {
      id: uid("tool"),
      kind: "tool",
      name: "read_file",
      summary: "读取 package.json 与 vite.config.ts",
      args: '{ "paths": ["package.json", "apps/web/vite.config.ts"] }',
      status: "running",
      createdAt: Date.now(),
    };
    yield { type: "tool", item: readTool };
    await wait(700, signal);
    yield {
      type: "tool.update",
      id: readTool.id,
      patch: {
        status: "done",
        durationMs: 76,
        output: "2 个文件 · 1.8 KB · 发现 dev / build 脚本",
      },
    };

    await wait(320, signal);
    yield {
      type: "plan",
      item: {
        ...plan,
        steps: [
          { id: "p1", title: "确认当前会话与项目状态", status: "done" },
          { id: "p2", title: "更新工作台并启动开发服务", status: "running" },
          { id: "p3", title: "验证预览地址与日志", status: "pending" },
        ],
      },
    };

    const runTool: ToolItem = {
      id: uid("tool"),
      kind: "tool",
      name: "run_command",
      summary: "pnpm --filter @larness/web dev",
      args: '{ "command": "pnpm --filter @larness/web dev", "cwd": ".", "timeout": 120000 }',
      status: "running",
      createdAt: Date.now(),
    };
    yield { type: "tool", item: runTool };
    await wait(1100, signal);
    yield {
      type: "tool.update",
      id: runTool.id,
      patch: {
        status: "done",
        durationMs: 1084,
        output: "VITE v7.1.7  ready in 412 ms\n➜  Local:   http://localhost:5173/",
      },
    };

    yield {
      type: "plan",
      item: {
        ...plan,
        steps: [
          { id: "p1", title: "确认当前会话与项目状态", status: "done" },
          { id: "p2", title: "更新工作台并启动开发服务", status: "done" },
          { id: "p3", title: "验证预览地址与日志", status: "running" },
        ],
      },
    };

    const summary = assistantMessage(uid("msg"), "");
    yield { type: "message.assistant", item: summary };
    for (const chunk of [
      "开发服务器已启动，端口 **5173**。",
      "你可以从顶部浏览器入口打开预览，",
      "或在右侧服务区查看实时日志。",
    ]) {
      await wait(180, signal);
      yield { type: "message.delta", id: summary.id, text: chunk };
    }

    yield {
      type: "artifact",
      item: {
        id: uid("art"),
        kind: "artifact",
        title: "本地预览已就绪",
        description: "Vite 开发服务运行在 5173，可从浏览器窗口打开。",
        meta: "http://localhost:5173",
        href: "http://localhost:5173",
        createdAt: Date.now(),
      },
    };
    yield {
      type: "plan",
      item: {
        ...plan,
        steps: [
          { id: "p1", title: "确认当前会话与项目状态", status: "done" },
          { id: "p2", title: "更新工作台并启动开发服务", status: "done" },
          { id: "p3", title: "验证预览地址与日志", status: "done" },
        ],
      },
    };
    yield { type: "turn.done" };
  }

  async resolveApproval(_approvalId: string, _decision: "approve" | "reject"): Promise<void> {
    await new Promise((resolve) => window.setTimeout(resolve, 600));
  }

  async cancelTurn(_sessionId: string): Promise<void> {
    await Promise.resolve();
  }
}

export const gateway = new MockGateway();
