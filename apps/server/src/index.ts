import { createApp } from "./app.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3210;

function readPort(value: string | undefined): number {
  if (value === undefined || value === "") {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`LARNESS_PORT must be an integer between 1 and 65535, received "${value}"`);
  }

  return port;
}

async function main(): Promise<void> {
  const app = createApp();
  const host = process.env.LARNESS_HOST ?? DEFAULT_HOST;
  const port = readPort(process.env.LARNESS_PORT);
  let closing = false;

  const shutdown = async (): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;
    await app.close();
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  try {
    await app.listen({ host, port });
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
    await app.close();
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[larness] failed to start: ${message}`);
  process.exitCode = 1;
}
