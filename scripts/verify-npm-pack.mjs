import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = process.cwd();
const cmdQuote = (value) =>
  /[\s"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
const runCmd = (command, args, options) =>
  execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", [command, ...args].map(cmdQuote).join(" ")], {
    ...options,
    windowsVerbatimArguments: true,
  });
const npm = (args, options = {}) =>
  process.platform === "win32"
    ? runCmd("npm", args, options)
    : execFileSync("npm", args, options);
const packOutput = JSON.parse(npm(["pack", "--json"], { cwd: root, encoding: "utf8" }))[0];
const tarball = path.join(root, packOutput.filename);
const paths = packOutput.files.map((file) => file.path.replaceAll("\\", "/"));

const required = [
  "app.js",
  "package.json",
  "apps/server/package.json",
  "apps/server/dist/tui.js",
  "apps/web/dist/index.html",
  "docs/guides/install.md",
];
const forbidden = [
  "apps/server/src/",
  "apps/web/src/",
  "node_modules/",
  "test-results/",
  "playwright-report/",
  ".env",
];
const missing = required.filter((entry) => !paths.includes(entry));
const leaked = paths.filter((entry) => forbidden.some((prefix) => entry.includes(prefix)));

if (missing.length > 0 || leaked.length > 0) {
  console.error("npm pack verification failed");
  if (missing.length > 0) console.error("missing:", missing);
  if (leaked.length > 0) console.error("forbidden:", leaked);
  rmSync(tarball, { force: true });
  process.exit(1);
}

const drizzle = paths.filter((entry) => entry.startsWith("apps/server/drizzle/"));
if (drizzle.length === 0) {
  console.error("npm pack verification failed: migrations are missing");
  rmSync(tarball, { force: true });
  process.exit(1);
}

const version = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;

if (process.argv.includes("--install")) {
  const prefix = mkdtempSync(path.join(tmpdir(), "larness-npm-pack-"));
  try {
    npm(["install", "-g", "--prefix", prefix, tarball], {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, npm_config_update_notifier: "false" },
    });
    const bin =
      process.platform === "win32"
        ? path.join(prefix, "larness.cmd")
        : path.join(prefix, "bin", "larness");
    const installed = (
      process.platform === "win32"
        ? runCmd(bin, ["--version"], { encoding: "utf8" })
        : execFileSync(bin, ["--version"], { encoding: "utf8" })
    ).trim();
    if (installed !== version) {
      throw new Error(`installed version ${installed} does not match ${version}`);
    }
    console.log(`installed ${packOutput.filename} (${paths.length} files) → larness ${installed}`);
  } finally {
    rmSync(prefix, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    rmSync(tarball, { force: true });
  }
} else {
  rmSync(tarball, { force: true });
  console.log(`npm pack ok: ${packOutput.filename} (${paths.length} files)`);
}
