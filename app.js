#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const commands = {
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
  node app.js                 Start Server + Web and enter the TUI
  node app.js tui             Same as above
  node app.js status          Print a read-only status snapshot
  node app.js doctor          Run local diagnostics (non-zero on failure)
  node app.js --version       Print the version
  node app.js --help          Show this help

Closing the TUI stops the Server and Web processes (ADR-023).
Environment:
  LARNESS_DATA_DIR, LARNESS_HOST, LARNESS_PORT, LARNESS_PUBLIC_URL,
  LARNESS_LOG_LEVEL, LARNESS_WEB_DIST`);
}

function runSource(sourcePath, args) {
  // Avoid a pnpm shell shim (and Windows .cmd quoting) by loading tsx through
  // Node's own --import flag, exactly like the managed TUI does.
  const require = createRequire(path.join(root, "apps", "server", "package.json"));
  const loader = pathToFileURL(require.resolve("tsx/esm")).href;
  const result = spawnSync(process.execPath, ["--import", loader, sourcePath, ...args], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(`[larness] cannot run source entry: ${result.error.message}`);
    console.error("Build first with `pnpm build`, or ensure tsx is installed.");
    process.exitCode = 1;
    return;
  }
  process.exitCode = result.status ?? 1;
}

function runTui() {
  const distPath = path.join(root, commands.tui.dist);
  const useDist = existsSync(distPath);

  process.env.LARNESS_TUI_MANAGED = "1";
  process.env.LARNESS_TUI_DEV = useDist ? "0" : "1";

  if (useDist) {
    import(pathToFileURL(distPath).href).catch((error) => {
      console.error(`[larness] tui failed: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
    return;
  }

  if (!existsSync(path.join(root, commands.tui.source))) {
    console.error("[larness] install is incomplete: apps/server/dist/tui.js is missing.");
    console.error("Reinstall with `npm install -g larness`.");
    process.exitCode = 1;
    return;
  }

  runSource(path.join(root, commands.tui.source), ["--managed", "--dev"]);
}

function runReadOnly(name) {
  const command = commands[name];
  const distPath = path.join(root, command.dist);

  if (existsSync(distPath)) {
    import(pathToFileURL(distPath).href).catch((error) => {
      console.error(`[larness] ${name} failed: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    });
    return;
  }

  if (!existsSync(path.join(root, command.source))) {
    console.error(`[larness] install is incomplete: apps/server/dist/${name}.js is missing.`);
    console.error("Reinstall with `npm install -g larness`.");
    process.exitCode = 1;
    return;
  }

  runSource(path.join(root, command.source), []);
}

const [first, ...rest] = process.argv.slice(2);

if (first === undefined || first === "tui" || first === "start") {
  runTui();
} else if (first === "--version" || first === "-v") {
  console.log(version());
} else if (first === "--help" || first === "-h" || first === "help") {
  help();
} else if ((first === "status" || first === "doctor") && rest.length === 0) {
  runReadOnly(first);
} else {
  console.error(`[larness] unknown command: ${first}`);
  help();
  process.exitCode = 1;
}
