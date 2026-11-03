import { createRequire } from "node:module";
import { release } from "node:os";
import { z } from "zod";
import { probeFiles, probeProcesses, probePty, probeRoots } from "./probes.js";

const migrations = z.string().min(1).parse(process.argv[2]);
const require = createRequire(import.meta.url);
const native = z
  .object({ version: z.string(), license: z.string() })
  .parse(require("node-pty/package.json"));
const results: Record<string, unknown> = {};
for (const [name, run] of [
  ["pty", probePty],
  ["processes", () => probeProcesses(migrations)],
  ["files", probeFiles],
  ["roots", () => probeRoots(migrations)],
] as const) {
  process.stderr.write(`M2-0 ${name}\n`);
  results[name] = await run();
}
process.stdout.write(
  `${JSON.stringify({
    node: process.version,
    abi: process.versions.modules,
    os: process.platform,
    release: release(),
    arch: process.arch,
    native,
    results,
  })}\n`,
);
