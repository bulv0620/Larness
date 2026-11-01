import { startServer } from "./bootstrap/start.js";

async function main(): Promise<void> {
  const running = await startServer();
  let stopping = false;

  const stop = (signal: string): void => {
    if (stopping) {
      return;
    }
    stopping = true;
    void running.shutdown(signal).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[larness] shutdown failed: ${message}`);
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[larness] failed to start: ${message}`);
  process.exitCode = 1;
}
