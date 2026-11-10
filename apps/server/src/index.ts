import { type RunningServer, startServer } from "./bootstrap/start.js";
import { receiveDevWebTarget } from "./dev-web/managed.js";

async function main(): Promise<void> {
  const managedDev = process.argv.includes("--managed-dev-web");
  let running: RunningServer | null = null;
  let stopping: string | null = null;
  const abort = new AbortController();
  const stop = (signal: string) => {
    stopping ??= signal;
    abort.abort();
    if (running)
      void running
        .shutdown(signal)
        .finally(() => {
          if (process.connected) process.disconnect();
        })
        .catch(() => {
          console.error("[larness] shutdown failed");
          process.exitCode = 1;
        });
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  // Windows has no graceful SIGTERM. The managed TUI asks this process to stop
  // over its IPC channel so locks, IPC endpoints and SQLite close cleanly.
  process.on("message", (message: unknown) => {
    if (typeof message === "object" && message !== null && "type" in message) {
      if ((message as { type?: unknown }).type === "larness.shutdown") stop("TUI shutdown");
    }
  });
  if (managedDev) process.once("disconnect", () => stop("parent disconnected"));
  const target = managedDev ? await receiveDevWebTarget(25_000, abort.signal) : undefined;
  abort.signal.throwIfAborted();
  running = await startServer(target ? { devWeb: target } : {});
  if (stopping) {
    await running.shutdown(stopping);
    if (process.connected) process.disconnect();
    return;
  }
  if (target) process.send?.({ type: "dev-web.attached", generation: target.generation });
}

try {
  await main();
} catch (error) {
  console.error(
    `[larness] failed to start: ${error instanceof Error ? error.message : "startup failed"}`,
  );
  process.exitCode = 1;
  if (process.connected) process.disconnect();
}
