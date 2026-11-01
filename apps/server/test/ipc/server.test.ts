import { readFile, stat } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { describe, expect, it } from "vitest";
import { ipcTokenPath } from "../../src/ipc/address.js";
import { connectIpc } from "../../src/ipc/client.js";
import { IpcError, MAX_FRAME_BYTES, RequestEnvelopeSchema } from "../../src/ipc/protocol.js";
import { type IpcServer, startIpcServer } from "../../src/ipc/server.js";
import { withTempDir } from "../helpers.js";

function startServer(
  dataDir: string,
  options: { idleTimeoutMs?: number; maxConnections?: number } = {},
): Promise<IpcServer> {
  return startIpcServer({
    dataDir,
    version: "test",
    idleTimeoutMs: options.idleTimeoutMs ?? 5_000,
    maxConnections: options.maxConnections,
    handler: async (request, context) => {
      if (request.method === "echo") {
        return { params: request.params, client: context.client, ipcClients: context.ipcClients };
      }
      if (request.method === "fail") {
        throw new IpcError("CONFLICT", "conflict");
      }
      return { method: request.method };
    },
  });
}

function rawConnect(address: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(address);
    socket.setEncoding("utf8");
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function nextLine(socket: Socket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for an IPC line"));
    }, 2_000);

    const onData = (chunk: string): void => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");

      if (newline >= 0) {
        cleanup();
        resolve(buffer.slice(0, newline));
      }
    };

    const onClose = (): void => {
      cleanup();
      reject(new Error("socket closed before a line arrived"));
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("close", onClose);
    };

    socket.on("data", onData);
    socket.on("close", onClose);
  });
}

function waitForClose(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("socket did not close")), 2_000);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("IPC server", () => {
  it("creates 0600 socket and token files and serves requests", async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir);

      try {
        if (process.platform !== "win32") {
          expect((await stat(server.address.path)).mode & 0o777).toBe(0o600);
          expect((await stat(ipcTokenPath(dir))).mode & 0o777).toBe(0o600);
        }

        const client = await connectIpc({ dataDir: dir, client: "test" });

        try {
          const echo = await client.request("echo", { value: 1 });
          expect(echo).toEqual({ params: { value: 1 }, client: "test", ipcClients: 1 });

          await expect(client.request("fail")).rejects.toMatchObject({ code: "CONFLICT" });
        } finally {
          client.close();
        }
      } finally {
        await server.close();
      }
    });
  });

  it("rejects a wrong token and closes the connection", async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir);

      try {
        const socket = await rawConnect(server.address.path);
        socket.write(
          `${JSON.stringify({
            id: "1",
            method: "hello",
            params: { token: "wrong-token", client: "test" },
          })}\n`,
        );

        const response = JSON.parse(await nextLine(socket)) as {
          ok: boolean;
          error?: { code: string };
        };
        expect(response.ok).toBe(false);
        expect(response.error?.code).toBe("INVALID_TOKEN");
        await waitForClose(socket);
      } finally {
        await server.close();
      }
    });
  });

  it("requires hello before any other method", async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir);

      try {
        const socket = await rawConnect(server.address.path);
        socket.write(`${JSON.stringify({ id: "1", method: "system.status", params: {} })}\n`);

        const response = JSON.parse(await nextLine(socket)) as {
          ok: boolean;
          error?: { code: string };
        };
        expect(response.ok).toBe(false);
        expect(response.error?.code).toBe("INVALID_TOKEN");
        await waitForClose(socket);
      } finally {
        await server.close();
      }
    });
  });

  it("rejects connections beyond the configured limit", async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, { maxConnections: 1 });

      try {
        const client = await connectIpc({ dataDir: dir, client: "first" });

        try {
          const second = await rawConnect(server.address.path);
          await waitForClose(second);

          await expect(client.request("echo", { ok: true })).resolves.toBeDefined();
        } finally {
          client.close();
        }
      } finally {
        await server.close();
      }
    });
  });

  it("keeps a long-idle client alive when keepAlive is enabled", async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, { idleTimeoutMs: 120 });

      try {
        const client = await connectIpc({
          dataDir: dir,
          client: "keepalive",
          keepAliveMs: 40,
        });

        try {
          await new Promise((resolve) => setTimeout(resolve, 320));
          await expect(client.request("echo", { ok: true })).resolves.toBeDefined();
        } finally {
          client.close();
        }
      } finally {
        await server.close();
      }
    });
  });

  it("closes idle connections", async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, { idleTimeoutMs: 100 });

      try {
        const token = (await readFile(ipcTokenPath(dir), "utf8")).trim();
        const socket = await rawConnect(server.address.path);
        socket.write(
          `${JSON.stringify({
            id: "1",
            method: "hello",
            params: { token, client: "idle" },
          })}\n`,
        );
        JSON.parse(await nextLine(socket));
        await waitForClose(socket);
      } finally {
        await server.close();
      }
    });
  });

  it("rejects frames over 1 MiB", async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir);

      try {
        const token = (await readFile(ipcTokenPath(dir), "utf8")).trim();
        const socket = await rawConnect(server.address.path);
        socket.write(
          `${JSON.stringify({
            id: "1",
            method: "hello",
            params: { token, client: "test" },
          })}\n`,
        );
        JSON.parse(await nextLine(socket));

        socket.write("x".repeat(MAX_FRAME_BYTES + 1));
        await waitForClose(socket);
      } finally {
        await server.close();
      }
    });
  });

  it("removes the socket and token on close", async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir);
      const socketPath = server.address.path;
      const tokenPath = ipcTokenPath(dir);

      await server.close();

      await expect(stat(socketPath)).rejects.toThrow();
      await expect(stat(tokenPath)).rejects.toThrow();
    });
  });
});

describe("RequestEnvelopeSchema", () => {
  it("rejects envelopes without an id", () => {
    expect(RequestEnvelopeSchema.safeParse({ method: "hello" }).success).toBe(false);
    expect(RequestEnvelopeSchema.safeParse({ id: "1", method: "hello" }).success).toBe(true);
  });
});
