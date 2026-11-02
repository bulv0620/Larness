import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, mergeConfig, type Plugin } from "vite";
import { devWebCache, HMR_PATH, NONCE_MARKER } from "../../server/src/dev-web/control.js";
import { webRoots } from "../../server/src/dev-web/paths.js";
import baseConfig from "../vite.config.js";

export async function startManagedVite(
  origin: string,
  root = fileURLToPath(new URL("..", import.meta.url)),
  generation: string = randomUUID(),
) {
  root = realpathSync(root);
  const canonical = new URL(origin);
  const dependencyRoots = webRoots(root);
  const cache = devWebCache(generation);
  await mkdir(cache, { mode: 0o700 });
  const roots = [...dependencyRoots, realpathSync(cache)];
  const client: Plugin = {
    name: "larness-managed-client",
    enforce: "post",
    transform(code, id) {
      if (!id.replaceAll("\\", "/").endsWith("/vite/dist/client/client.mjs")) return;
      const marker = "await wsTransport.connect(handlers);";
      if (!code.includes(marker)) throw new Error("Unsupported Vite client transport");
      return code
        .replace(/const serverHost = .*?;/, `const serverHost = ${JSON.stringify(canonical.host)};`)
        .replace(
          /const directSocketHost = .*?;/,
          `const directSocketHost = ${JSON.stringify(canonical.host + HMR_PATH)};`,
        )
        .replace(
          marker,
          "await (async () => { for (;;) { try { await wsTransport.connect(handlers); return; } catch { await new Promise(done => setTimeout(done, 1000)); } } })();",
        );
    },
  };
  const config = mergeConfig(baseConfig, {
    root,
    cacheDir: cache,
    configFile: false,
    clearScreen: false,
    logLevel: "error",
    plugins: [client],
    html: { cspNonce: NONCE_MARKER },
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: true,
      open: false,
      cors: false,
      allowedHosts: ["127.0.0.1"],
      hmr: {
        host: canonical.hostname,
        protocol: canonical.protocol === "https:" ? "wss" : "ws",
        clientPort: Number(canonical.port || (canonical.protocol === "https:" ? 443 : 80)),
        path: HMR_PATH,
      },
      fs: {
        strict: true,
        allow: roots,
        deny: [
          "**/.env",
          "**/.env.*",
          "**/.git/**",
          "**/master.key",
          "**/config.json",
          "**/larness.db*",
          "**/*.log",
        ],
      },
      warmup: { clientFiles: [path.join(root, "index.html")] },
    },
  });
  if (config.server) delete config.server.proxy;
  const server = await createServer(config).catch(async (error: unknown) => {
    await rm(cache, { recursive: true, force: true });
    throw error;
  });
  try {
    const close = server.close.bind(server);
    server.close = async () => {
      try {
        await close();
      } finally {
        await rm(cache, { recursive: true, force: true });
      }
    };
    // Vite 7's listen() treats port 0 as its default 5173. Its public HTTP
    // listener still initializes Vite and lets the OS bind an ephemeral port.
    const listener = server.httpServer;
    if (!listener) throw new Error("Missing Vite listener");
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", () => {
        listener.off("error", reject);
        resolve();
      });
    });
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing Vite listener");
    return { server, port: address.port, roots };
  } catch (error) {
    await server.close();
    throw error;
  }
}
