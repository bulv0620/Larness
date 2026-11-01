import { collectStatus } from "../status.js";

try {
  const status = await collectStatus();
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[larness] status failed: ${message}\n`);
  process.exitCode = 1;
}
