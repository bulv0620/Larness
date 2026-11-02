import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createServer } from "node:https";
import { connect } from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";

// Disposable loopback TLS reverse proxy; never consumes user certificates.
export async function startUnifiedTlsFixture(root: string, targetPort: number) {
  const directory = path.join(root, "tls");
  await mkdir(directory);
  const config = path.join(directory, "fixture.cnf");
  await writeFile(
    config,
    "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\n",
  );
  const keyFile = path.join(directory, "fixture.key");
  const certFile = path.join(directory, "fixture.crt");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-sha256",
      "-days",
      "1",
      "-config",
      config,
      "-keyout",
      keyFile,
      "-out",
      certFile,
    ],
    { stdio: "ignore" },
  );
  await chmod(keyFile, 0o600);
  const sockets = new Set<Duplex>();
  const server = createServer(
    { key: await readFile(keyFile), cert: await readFile(certFile) },
    (req, res) => {
      const upstream = request(
        {
          host: "127.0.0.1",
          port: targetPort,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, "x-forwarded-proto": "https" },
          agent: false,
        },
        (response) => {
          res.writeHead(response.statusCode ?? 503, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(503);
        res.end();
      });
      req.on("aborted", () => upstream.destroy());
      req.pipe(upstream);
    },
  );
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (req, socket, head) => {
    const upstream = connect(targetPort, "127.0.0.1");
    sockets.add(upstream);
    upstream.on("close", () => {
      sockets.delete(upstream);
      socket.destroy();
    });
    socket.on("close", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.once("connect", () => {
      const headers = { ...req.headers, "x-forwarded-proto": "https" };
      const lines = Object.entries(headers).flatMap(([name, value]) =>
        value === undefined ? [] : [`${name}: ${Array.isArray(value) ? value.join(", ") : value}`],
      );
      upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TLS fixture failed to listen");
  return {
    origin: `https://localhost:${address.port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
