import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import { type IpcAddress, ipcTokenPath, resolveIpcAddress } from "./address.js";
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  errorResponse,
  HelloParamsSchema,
  IpcError,
  type IpcResponse,
  MAX_CONNECTIONS,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
  RequestEnvelopeSchema,
} from "./protocol.js";

export interface IpcRequestContext {
  client: string;
  ipcClients: number;
}

export type IpcHandler = (
  request: { id: string; method: string; params?: unknown },
  context: IpcRequestContext,
) => Promise<unknown> | unknown;

export interface IpcLogger {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface IpcServerOptions {
  dataDir: string;
  version: string;
  handler: IpcHandler;
  idleTimeoutMs?: number;
  maxConnections?: number;
  platform?: NodeJS.Platform;
  tempRoot?: string;
  logger?: IpcLogger;
}

export interface IpcServer {
  address: IpcAddress;
  clients(): number;
  broadcast(event: string, data: unknown): void;
  close(): Promise<void>;
}

interface ConnectionState {
  socket: Socket;
  buffer: string;
  handshaken: boolean;
  client: string;
  idleTimer: NodeJS.Timeout;
  queue: Promise<void>;
}

function tokensMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function extractRequestId(value: unknown): string {
  if (typeof value === "object" && value !== null && "id" in value) {
    const id = value.id;
    if (typeof id === "string" && id.length > 0 && id.length <= 128) {
      return id;
    }
  }

  return "unknown";
}

export async function startIpcServer(options: IpcServerOptions): Promise<IpcServer> {
  const token = randomBytes(32).toString("base64url");
  const tokenPath = ipcTokenPath(options.dataDir);
  const address = resolveIpcAddress(options.dataDir, options.platform, options.tempRoot);
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const maxConnections = options.maxConnections ?? MAX_CONNECTIONS;

  await mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });

  if (address.kind === "unix") {
    await mkdir(path.dirname(address.path), { recursive: true, mode: 0o700 });

    if (address.tempDirectory !== null) {
      await chmod(address.tempDirectory, 0o700);
    }
  }

  await writeFile(tokenPath, token, { mode: 0o600 });

  if (process.platform !== "win32") {
    await chmod(tokenPath, 0o600);
  }

  if (address.kind === "unix") {
    await rm(address.path, { force: true });
  }

  const sockets = new Set<Socket>();
  const clients = new Set<Socket>();

  const server: Server = createServer((socket) => {
    if (sockets.size >= maxConnections) {
      socket.destroy();
      return;
    }

    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.setNoDelay(true);

    const state: ConnectionState = {
      socket,
      buffer: "",
      handshaken: false,
      client: "unknown",
      idleTimer: setTimeout(() => socket.destroy(), idleTimeoutMs),
      queue: Promise.resolve(),
    };
    state.idleTimer.unref();

    const send = (response: IpcResponse | { event: string; data: unknown }): void => {
      if (!socket.destroyed) {
        socket.write(`${JSON.stringify(response)}\n`);
      }
    };

    const handleLine = async (line: string): Promise<void> => {
      let parsed: unknown;

      try {
        parsed = JSON.parse(line);
      } catch {
        socket.destroy();
        return;
      }

      const envelope = RequestEnvelopeSchema.safeParse(parsed);

      if (!state.handshaken) {
        const hello = HelloParamsSchema.safeParse(
          typeof parsed === "object" && parsed !== null && "params" in parsed
            ? parsed.params
            : undefined,
        );

        if (!envelope.success || envelope.data.method !== "hello" || !hello.success) {
          send({
            id: envelope.success ? envelope.data.id : extractRequestId(parsed),
            ok: false,
            error: { code: "INVALID_TOKEN", message: "IPC hello with a valid token is required" },
          });
          socket.destroy();
          return;
        }

        if (!tokensMatch(hello.data.token, token)) {
          send({
            id: envelope.data.id,
            ok: false,
            error: { code: "INVALID_TOKEN", message: "invalid IPC token" },
          });
          socket.destroy();
          return;
        }

        state.handshaken = true;
        state.client = hello.data.client;
        clients.add(socket);

        send({
          id: envelope.data.id,
          ok: true,
          result: { protocolVersion: PROTOCOL_VERSION, serverVersion: options.version },
        });
        return;
      }

      if (!envelope.success) {
        send({
          id: extractRequestId(parsed),
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "invalid IPC request envelope" },
        });
        return;
      }

      try {
        const result = await options.handler(envelope.data, {
          client: state.client,
          ipcClients: clients.size,
        });
        send({ id: envelope.data.id, ok: true, result: result ?? {} });
      } catch (error) {
        send(errorResponse(envelope.data.id, error));
      }
    };

    socket.on("data", (chunk: string) => {
      state.idleTimer.refresh();
      state.buffer += chunk;

      if (Buffer.byteLength(state.buffer, "utf8") > MAX_FRAME_BYTES) {
        options.logger?.warn({ client: state.client }, "IPC frame exceeded the size limit");
        socket.destroy();
        return;
      }

      let newline = state.buffer.indexOf("\n");

      while (newline >= 0) {
        const line = state.buffer.slice(0, newline).trim();
        state.buffer = state.buffer.slice(newline + 1);

        if (line.length > 0) {
          state.queue = state.queue.then(() => handleLine(line)).catch(() => undefined);
        }

        newline = state.buffer.indexOf("\n");
      }
    });

    socket.on("error", () => socket.destroy());
    socket.on("close", () => {
      clearTimeout(state.idleTimer);
      sockets.delete(socket);
      clients.delete(socket);
    });
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(address.path, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
  } catch (error) {
    await rm(tokenPath, { force: true }).catch(() => undefined);

    if (address.kind === "unix") {
      await rm(address.path, { force: true }).catch(() => undefined);
    }

    throw error;
  }

  if (address.kind === "unix") {
    await chmod(address.path, 0o600);
  }

  let closing: Promise<void> | null = null;

  return {
    address,
    clients: () => clients.size,
    broadcast: (event, data) => {
      const frame = `${JSON.stringify({ event, data })}\n`;

      for (const client of clients) {
        if (!client.destroyed) {
          client.write(frame);
        }
      }
    },
    close: () => {
      if (closing !== null) {
        return closing;
      }

      closing = (async () => {
        const closed = new Promise<void>((resolve) => {
          server.close(() => resolve());
        });

        for (const socket of sockets) {
          socket.destroy();
        }

        await closed;
        await rm(tokenPath, { force: true }).catch(() => undefined);

        if (address.kind === "unix") {
          await rm(address.path, { force: true }).catch(() => undefined);
        }

        if (address.tempDirectory !== null) {
          await rm(address.tempDirectory, { recursive: true, force: true }).catch(() => undefined);
        }
      })();

      return closing;
    },
  };
}

export { IpcError };
