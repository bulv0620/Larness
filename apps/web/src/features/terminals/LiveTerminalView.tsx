import {
  TerminalInputAckSchema as Ack,
  TerminalErrorSchema as Failure,
  TerminalSubscribeAckSchema as Subscription,
  TerminalEventSchema,
  TerminalOutputEventSchema,
} from "@larness/shared";
import { useQuery } from "@tanstack/react-query";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { queryClient } from "@/lib/queries";
import { useWindowStore } from "@/stores/windowStore";
import {
  ended,
  OutputSchema,
  readTerminal,
  terminalAction,
  terminalKey,
  terminalTitle,
} from "./api";
import "@xterm/xterm/css/xterm.css";

const labels = {
  CREATED: "正在创建",
  RUNNING: "运行中",
  STOPPING: "正在终止",
  EXITED: "已退出",
  TERMINATED: "已终止",
  INTERRUPTED: "已中断",
};

export function LiveTerminalView({ id }: { id: string }) {
  const query = useQuery({
    queryKey: terminalKey(id),
    queryFn: () => readTerminal(id),
    refetchInterval: 2000,
  });
  const title = query.data ? terminalTitle(query.data) : null;
  useEffect(() => {
    if (title === null) return;
    const state = useWindowStore.getState();
    if (
      !state.windows.some((win) =>
        win.tabs.some((tab) => tab.resourceId === id && tab.title !== title),
      )
    )
      return;
    useWindowStore.setState({
      windows: state.windows.map((win) => ({
        ...win,
        tabs: win.tabs.map((tab) =>
          tab.resourceId === id && tab.title !== title ? { ...tab, title } : tab,
        ),
      })),
    });
  }, [id, title]);
  const snapshot = useRef(query.data);
  snapshot.current = query.data;
  const container = useRef<HTMLDivElement>(null);
  const control = useRef<{
    acquire: () => Promise<void>;
    takeover: () => Promise<void>;
    release: () => Promise<void>;
  } | null>(null);
  const [inputReady, setInputReady] = useState(false);
  const [connection, setConnection] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [gap, setGap] = useState(false);
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const lease = query.data?.lease;
  const held =
    !!connection &&
    lease?.ownerConnectionId === connection &&
    lease.expiresAt > now &&
    query.data?.status === "RUNNING" &&
    !query.isError;

  const ours = held && inputReady;
  const aiControlled =
    lease?.ownerType === "agent" &&
    lease.expiresAt > now &&
    query.data?.status === "RUNNING" &&
    !query.isError;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let disposed = false,
      cursor = 0,
      syncing = false,
      delay = 500;
    let socket: WebSocket | undefined;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let cid: string | null = null,
      generation: number | null = null,
      sequence = 0;
    let lastGeneration: number | null = null;
    let pending: number | null = null;
    let queue: string[] = [],
      queueBytes = 0;
    const term = new Terminal({
      fontSize: 12,
      fontFamily: "ui-monospace, Menlo, monospace",
      cursorBlink: true,
      scrollback: 2000,
      disableStdin: true,
      theme: { background: "#0f1115", foreground: "#d7dae0" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(element);
    setLog("");
    setGap(false);
    setError("");
    setConnection(null);
    const invalidate = () => {
      if (!disposed) void queryClient.invalidateQueries({ queryKey: terminalKey(id) });
    };
    const canInput = () => {
      const row = snapshot.current;
      return (
        !!cid &&
        !!generation &&
        row?.status === "RUNNING" &&
        row.lease?.ownerConnectionId === cid &&
        row.lease.generation === generation &&
        row.lease.expiresAt > Date.now() &&
        socket?.readyState === WebSocket.OPEN
      );
    };
    const dropControl = () => {
      generation = null;
      setInputReady(false);
      pending = null;
      queue = [];
      queueBytes = 0;
      term.options.disableStdin = true;
    };
    const drain = () => {
      if (!canInput() || pending !== null || !queue.length) return;
      const data = queue.shift();
      if (data === undefined) return;
      queueBytes -= new TextEncoder().encode(data).length;
      pending = ++sequence;
      socket?.send(
        JSON.stringify({
          type: "terminal.input",
          terminalId: id,
          leaseGeneration: generation,
          inputSequence: pending,
          data,
        }),
      );
    };
    const input = term.onData((data) => {
      if (!canInput()) return;
      const size = new TextEncoder().encode(data).length;
      if (size > 8192 || queueBytes + size > 32768) {
        setError("输入过大，请分段粘贴（单次最多 8 KiB）。");
        return;
      }
      queue.push(data);
      queueBytes += size;
      drain();
    });
    const sync = async () => {
      if (syncing || disposed) return;
      syncing = true;
      try {
        // Consume bounded pages in order. WS is a wakeup; HTTP is the replay source.
        for (let page = 0; page < 8 && !disposed; page++) {
          const result = OutputSchema.parse(
            await apiFetch(
              `/api/terminals/${encodeURIComponent(id)}/output?after=${cursor}&limit=100`,
            ),
          );
          if (disposed) return;
          if (result.resyncRequired || result.truncated) setGap(true);
          for (const chunk of result.chunks) {
            if (chunk.cursor <= cursor) continue;
            if (chunk.cursor !== cursor + 1) setGap(true);
            await new Promise<void>((resolve) => term.write(chunk.data, resolve));
            if (disposed) return;
            setLog((old) => (old + chunk.data).slice(-16384));
            cursor = chunk.cursor;
          }
          cursor = Math.max(cursor, result.nextCursor);
          if (!result.chunks.length) break;
        }
      } catch {
        if (!disposed) setError("输出读取失败，正在重试；历史可能不完整。");
      } finally {
        syncing = false;
      }
    };
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const resize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (disposed || !element.clientWidth || !element.clientHeight) return;
        fit.fit();
        if (canInput())
          void terminalAction(id, "resize", {
            connectionId: cid,
            leaseGeneration: generation,
            cols: Math.max(2, Math.min(500, term.cols)),
            rows: Math.max(1, Math.min(300, term.rows)),
          }).catch(() => {
            if (!disposed) {
              dropControl();
              invalidate();
              setError("尺寸同步失败，请重新获取输入权。");
            }
          });
      }, 100);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    const connect = () => {
      if (disposed) return;
      const url = new URL("/ws", location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url);
      socket = ws;
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            type: "subscribe",
            subscriptions: [{ topic: "terminal", resourceId: id, after: 0 }],
          }),
        );
      ws.onmessage = (message) => {
        if (disposed || socket !== ws) return;
        let raw: unknown;
        try {
          raw = JSON.parse(String(message.data));
        } catch {
          dropControl();
          setError("终端响应无效，请刷新。");
          return;
        }
        const subscribed = Subscription.safeParse(raw);
        if (subscribed.success && subscribed.data.subscription.resourceId === id) {
          cid = subscribed.data.connectionId;
          setConnection(cid);
          delay = 500;
          invalidate();
          void sync();
          return;
        }
        const ack = Ack.safeParse(raw);
        if (ack.success && pending === ack.data.inputSequence) {
          pending = null;
          drain();
          return;
        }
        const event = TerminalEventSchema.safeParse(raw);
        if (event.success && event.data.resourceId === id) {
          if (
            event.data.payload.lease?.generation !== generation ||
            event.data.payload.lease?.ownerConnectionId !== cid ||
            event.data.payload.status !== "RUNNING"
          )
            dropControl();
          invalidate();
          void sync();
          return;
        }
        if (TerminalOutputEventSchema.safeParse(raw).success) {
          void sync();
          return;
        }
        const failure = Failure.safeParse(raw);
        if (failure.success) {
          dropControl();
          invalidate();
          setError(`终端操作被拒绝（${failure.data.code}），请重新获取输入权。`);
        }
      };
      ws.onclose = () => {
        if (disposed) return;
        cid = null;
        setConnection(null);
        dropControl();
        invalidate();
        setError("连接已断开，正在重连；不会重放输入。");
        reconnect = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 10000);
      };
    };
    const applyLease = (row: Awaited<ReturnType<typeof terminalAction>>) => {
      if (!row.lease) return;
      snapshot.current = row;
      queryClient.setQueryData(terminalKey(id), row);
      generation = row.lease.generation;
      if (lastGeneration !== generation) sequence = 0;
      lastGeneration = generation;
      setInputReady(true);
      pending = null;
      term.options.disableStdin = false;
      term.focus();
      resize();
      setError("");
    };
    control.current = {
      acquire: async () => {
        if (!cid) throw new Error("Disconnected");
        const expected = cid;
        const row = await terminalAction(id, "lease", {
          action: "acquire",
          connectionId: expected,
        });
        if (disposed || cid !== expected || row.lease?.ownerConnectionId !== expected) return;
        applyLease(row);
      },
      takeover: async () => {
        if (!cid) throw new Error("Disconnected");
        const expected = cid;
        const row = await terminalAction(id, "takeover", { connectionId: expected });
        if (disposed || cid !== expected || row.lease?.ownerConnectionId !== expected) return;
        applyLease(row);
      },
      release: async () => {
        const current = snapshot.current?.lease;
        const old = current?.ownerConnectionId === cid ? current?.generation : generation;
        dropControl();
        if (cid && old)
          await terminalAction(id, "lease", {
            action: "release",
            connectionId: cid,
            leaseGeneration: old,
          });
      },
    };
    const renew = setInterval(() => {
      if (!canInput()) return;
      const expected = cid;
      const expectedGeneration = generation;
      void terminalAction(id, "lease", {
        action: "renew",
        connectionId: cid,
        leaseGeneration: generation,
      })
        .then((row) => {
          if (!disposed && expected === cid && expectedGeneration === generation) {
            snapshot.current = row;
            queryClient.setQueryData(terminalKey(id), row);
          }
        })
        .catch(() => {
          if (!disposed) {
            dropControl();
            invalidate();
            setError("输入租约续期失败，请重新获取输入权。");
          }
        });
    }, 10000);
    const tick = setInterval(() => {
      setNow(Date.now());
      term.options.disableStdin = !canInput();
      if (!canInput()) setInputReady(false);
      void sync();
    }, 1000);
    connect();
    return () => {
      disposed = true;
      control.current = null;
      clearTimeout(reconnect);
      clearTimeout(resizeTimer);
      clearInterval(renew);
      clearInterval(tick);
      observer.disconnect();
      input.dispose();
      socket?.close();
      term.dispose();
    };
  }, [id]);
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError("终端操作失败，请刷新状态后重试。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      data-testid="live-terminal"
      data-terminal-id={id}
      className="flex h-full min-h-0 flex-col bg-[#0f1115] text-white/80"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 p-2 text-[11px]">
        <span role="status">{query.data ? labels[query.data.status] : "读取终端…"}</span>
        <span>{ours ? "你正在控制" : aiControlled ? "AI 控制中" : "只读观察"}</span>
        <button
          type="button"
          aria-label={held ? "释放输入权" : aiControlled ? "接管控制" : "获取输入权"}
          title={held ? "释放输入，允许 AI 获取控制" : "点击终端也可开始输入"}
          disabled={
            busy ||
            !connection ||
            !query.data ||
            query.isError ||
            query.data.status !== "RUNNING" ||
            (!held && !aiControlled && !!lease && lease.expiresAt > now)
          }
          onClick={() =>
            void act(async () => {
              if (held) await control.current?.release();
              else if (aiControlled) await control.current?.takeover();
              else await control.current?.acquire();
            })
          }
        >
          {held ? "交给 AI" : aiControlled ? "接管控制" : "开始输入"}
        </button>
        <button
          type="button"
          disabled={
            busy || !query.data || ended(query.data.status) || query.data.status === "STOPPING"
          }
          onClick={() => void act(() => terminalAction(id, "terminate", { confirmed: true }))}
        >
          终止终端
        </button>
      </div>
      {query.data?.reasonCode ? (
        <p className="px-2 text-xs">状态原因：{query.data.reasonCode}</p>
      ) : null}
      {query.data?.exitCode !== null && query.data?.exitCode !== undefined ? (
        <p className="px-2 text-xs">退出码 {query.data.exitCode}</p>
      ) : null}
      {gap ? (
        <p role="status" className="px-2 text-xs text-amber-300">
          部分历史输出已过期或缺失，当前回放不完整。
        </p>
      ) : null}
      {error || query.isError ? (
        <p role="alert" className="px-2 text-xs text-red-300">
          {error || "终端不可用，请刷新核对；不会自动重建。"}
        </p>
      ) : null}
      <div
        ref={container}
        role="application"
        aria-label="交互终端"
        className="min-h-0 flex-1 p-2"
        onPointerDown={() => {
          if (
            !held &&
            !aiControlled &&
            connection &&
            !busy &&
            (!lease || lease.expiresAt <= Date.now()) &&
            query.data?.status === "RUNNING"
          )
            void act(async () => {
              await control.current?.acquire();
            });
        }}
      />
      <pre role="log" aria-label="终端输出" aria-live="off" className="sr-only">
        {log}
      </pre>
    </div>
  );
}
