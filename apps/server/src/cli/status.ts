import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectIpc } from "../ipc/client.js";
import { resolveDataDir } from "../platform/paths.js";
import { collectStatus, type StatusReport } from "../status.js";

export interface ReadStatusOptions {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Merges the live IPC snapshot over the local report. A server started before
 * this CLI version does not send the newer fields, so fall back per field
 * instead of formatting an incomplete object.
 */
export function completeStatus(
  remote: Partial<StatusReport>,
  fallback: StatusReport,
): StatusReport {
  const defined = Object.fromEntries(
    Object.entries(remote).filter(([, value]) => value !== undefined),
  ) as Partial<StatusReport>;
  const merged: StatusReport = { ...fallback, ...defined };

  return {
    ...merged,
    warnings: merged.warnings.filter(
      (warning) => !(merged.running && warning === "server is not running"),
    ),
  };
}

export async function readStatus(options: ReadStatusOptions = {}): Promise<StatusReport> {
  const dataDir = options.dataDir ?? resolveDataDir(options.env ?? process.env);

  try {
    const client = await connectIpc({ dataDir, client: "status", timeoutMs: 1_500 });

    try {
      const remote = (await client.request("system.status", {}, 1_500)) as Partial<StatusReport>;
      const local = await collectStatus({
        dataDir,
        ...(options.env === undefined ? {} : { env: options.env }),
      });
      return completeStatus(remote, local);
    } finally {
      client.close();
    }
  } catch {
    return collectStatus({ dataDir, ...(options.env === undefined ? {} : { env: options.env }) });
  }
}

function isEntryPoint(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isEntryPoint()) {
  try {
    const status = await readStatus();
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[larness] status failed: ${message}\n`);
    process.exitCode = 1;
  }
}
