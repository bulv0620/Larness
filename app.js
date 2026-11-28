#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const distEntry = path.join(root, "apps", "server", "dist", "cli.js");
const sourceEntry = path.join(root, "apps", "server", "src", "cli", "main.ts");

if (existsSync(distEntry)) {
  await import(pathToFileURL(distEntry).href);
} else if (existsSync(sourceEntry)) {
  // Source checkouts without a build still get the same command surface.
  const require = createRequire(path.join(root, "apps", "server", "package.json"));
  const loader = pathToFileURL(require.resolve("tsx/esm")).href;
  const result = spawnSync(
    process.execPath,
    ["--import", loader, sourceEntry, ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    },
  );

  if (result.error) {
    console.error(`[larness] cannot run the source entry: ${result.error.message}`);
    console.error("Build first with `pnpm build`, or ensure tsx is installed.");
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
} else {
  console.error("[larness] install is incomplete: apps/server/dist/cli.js is missing.");
  console.error("Reinstall with `npm install -g larness`.");
  process.exitCode = 1;
}
