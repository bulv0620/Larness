import { connectIpc } from "../ipc/client.js";
import { resolveDataDir } from "../platform/paths.js";
import { collectStatus, type StatusReport } from "../status.js";

async function readStatus(): Promise<StatusReport> {
  const dataDir = resolveDataDir();

  try {
    const client = await connectIpc({ dataDir, client: "status", timeoutMs: 1_500 });

    try {
      return (await client.request("system.status", {}, 1_500)) as StatusReport;
    } finally {
      client.close();
    }
  } catch {
    return collectStatus({ dataDir });
  }
}

try {
  const status = await readStatus();
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[larness] status failed: ${message}\n`);
  process.exitCode = 1;
}
