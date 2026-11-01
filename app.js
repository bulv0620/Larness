#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const commands = {
  server: { dist: "apps/server/dist/index.js", source: "apps/server/src/index.ts" },
  tui: { dist: "apps/server/dist/tui.js", source: "apps/server/src/tui/main.ts" },
  status: { dist: "apps/server/dist/status.js", source: "apps/server/src/cli/status.ts" },
  doctor: { dist: "apps/server/dist/doctor.js", source: "apps/server/src/cli/doctor.ts" },
};

function version() {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function help() {
  console.log(`Larness ${version()}

Usage:
  node app.js                 Start the server (default)
  node app.js server          Start the server
  node app.js tui             Open the local TUI over IPC
  node app.js status          Print a read-only status snapshot
  node app.js doctor          Run local diagnostics (non-zero on failure)
  node app.js --version       Print the version
  node app.js --help          Show this help

Environment:
  LARNESS_DATA_DIR, LARNESS_HOST, LARNESS_PORT, LARNESS_PUBLIC_URL,
  LARNESS_LOG_LEVEL, LARNESS_WEB_DIST`);
}

function runCommand(name) {
  const command = commands[name];
  const distPath = path.join(root, command.dist);

  if (existsSync(distPath)) {
    import(pathToFileURL(distPath).href).catch((error) => {
      console.error(`[larness] ${name} failed: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
    return;
  }

  const sourcePath = path.join(root, command.source);
  const result = spawnSync("pnpm", ["--filter", "@larness/server", "exec", "tsx", sourcePath], {
    cwd: root,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`[larness] cannot run ${name}: ${result.error.message}`);
    console.error(
      "Build first with `pnpm build`, or ensure pnpm/tsx are available for development.",
    );
    process.exitCode = 1;
    return;
  }

  process.exitCode = result.status ?? 1;
}

const [first, ...rest] = process.argv.slice(2);

if (first === undefined || first === "server") {
  runCommand("server");
} else if (first === "--version" || first === "-v") {
  console.log(version());
} else if (first === "--help" || first === "-h" || first === "help") {
  help();
} else if (first in commands && rest.length === 0) {
  runCommand(first);
} else {
  console.error(`[larness] unknown command: ${first}`);
  help();
  process.exitCode = 1;
}
