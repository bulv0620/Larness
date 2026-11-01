import { readFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { ipcTokenPath, resolveIpcAddress } from "./address.js";
import { IpcError, type IpcErrorCode, type IpcResponse, PROTOCOL_VERSION } from "./protocol.js";

export class IpcClientError extends Error {
  readonly code: IpcErrorCode | "TIMEOUT" | "CONNECTION_CLOSED";

  constructor(code: IpcErrorCode | "TIMEOUT" | "CONNECTION_CLOSED", message: string) {
    super(message);
    this.name = "IpcClientError";
    this.code = code;
  }
}

export interface IpcClient {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  close(): void;
}

export interface ConnectIpcOptions {
  dataDir: string;
  client?: string;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  keepAliveMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 5_000;

function connectSocket(address: string, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(address);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new IpcClientError("TIMEOUT", "timed out connecting to the IPC socket"));
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

export async function connectIpc(options: ConnectIpcOptions): Promise<IpcClient> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const token = (await readFile(ipcTokenPath(options.dataDir), "utf8")).trim();
  const address = resolveIpcAddress(options.dataDir, options.platform);
  const socket = await connectSocket(address.path, timeoutMs);
  const pending = new Map<string, PendingRequest>();
  let buffer = "";
  let nextId = 1;
  let closed = false;

  const rejectAll = (error: Error): void => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };

  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");

    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");

      if (line.length === 0) {
        continue;
      }

      let message: IpcResponse | { event: string; data: unknown };

      try {
        message = JSON.parse(line) as IpcResponse | { event: string; data: unknown };
      } catch {
        continue;
      }

      if (!("id" in message)) {
        continue;
      }

      const request = pending.get(message.id);

      if (request === undefined) {
        continue;
      }

      pending.delete(message.id);
      clearTimeout(request.timer);

      if (message.ok) {
        request.resolve(message.result);
      } else {
        request.reject(new IpcError(message.error.code, message.error.message));
      }
    }
  });
  socket.on("error", () => socket.destroy());
  socket.on("close", () => {
    closed = true;
    rejectAll(new IpcClientError("CONNECTION_CLOSED", "IPC connection closed"));
  });

  const send = (method: string, params: unknown, requestTimeoutMs: number): Promise<unknown> => {
    if (closed) {
      return Promise.reject(new IpcClientError("CONNECTION_CLOSED", "IPC connection closed"));
    }

    const id = String(nextId++);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new IpcClientError("TIMEOUT", `IPC request ${method} timed out`));
      }, requestTimeoutMs);

      pending.set(id, { resolve, reject, timer });
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  };

  const hello = await send(
    "hello",
    { token, client: options.client ?? "status", pid: process.pid },
    timeoutMs,
  ).catch((error) => {
    socket.destroy();
    throw error;
  });

  const version = (hello as { protocolVersion?: unknown }).protocolVersion;

  if (version !== PROTOCOL_VERSION) {
    socket.destroy();
    throw new IpcClientError("PROTOCOL_MISMATCH", "IPC protocol version mismatch");
  }

  const keepAliveTimer =
    options.keepAliveMs !== undefined && options.keepAliveMs > 0
      ? setInterval(() => {
          void send("system.ping", {}, timeoutMs).catch(() => undefined);
        }, options.keepAliveMs)
      : null;
  keepAliveTimer?.unref();

  return {
    request: (method, params, requestTimeoutMs = timeoutMs) =>
      send(method, params ?? {}, requestTimeoutMs),
    close: () => {
      closed = true;

      if (keepAliveTimer !== null) {
        clearInterval(keepAliveTimer);
      }

      socket.destroy();
    },
  };
}
