import { chmodSync, existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { satisfies } from "semver";

const require = createRequire(import.meta.url);
const checks = [];
const fail = (name, message) => {
  checks.push({ name, ok: false, message });
};

function ensurePtyHelper() {
  if (process.platform !== "darwin") return;
  try {
    const root = path.dirname(require.resolve("node-pty/package.json"));
    for (const relative of [
      `prebuilds/darwin-${process.arch}/spawn-helper`,
      "build/Release/spawn-helper",
    ]) {
      const helper = path.join(root, relative);
      if (existsSync(helper)) chmodSync(helper, 0o755);
    }
  } catch {
    // Report the actual PTY failure below.
  }
}

async function checkSqlite() {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(":memory:");
    const row = db.prepare("select 1 as ok").get();
    db.close();
    checks.push({ name: "better-sqlite3", ok: row?.ok === 1 });
  } catch (error) {
    fail("better-sqlite3", error instanceof Error ? error.message : String(error));
  }
}

async function checkPty() {
  ensurePtyHelper();
  try {
    const pty = require("node-pty");
    const file = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "/bin/echo";
    const args = process.platform === "win32" ? ["/d", "/s", "/c", "echo larness-pty-ok"] : ["larness-pty-ok"];
    const child = pty.spawn(file, args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env,
    });
    let output = "";
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // The child may already be gone.
        }
        resolve({ ok: false, message: "pty timeout" });
      }, 5_000);
      child.onData((data) => {
        output += data;
      });
      child.onExit(() => {
        clearTimeout(timer);
        resolve({ ok: output.includes("larness-pty-ok"), message: output.trim().slice(0, 200) });
      });
    });
    checks.push({ name: "node-pty", ...result });
  } catch (error) {
    fail("node-pty", error instanceof Error ? error.message : String(error));
  }
}

async function checkFiles() {
  const dir = await mkdtemp(path.join(tmpdir(), "larness-platform-"));
  try {
    const file = path.join(dir, "probe.txt");
    await writeFile(file, "larness", "utf8");
    const text = await readFile(file, "utf8");
    checks.push({ name: "filesystem", ok: text === "larness" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const nodeRange = require("../package.json").engines.node;
if (!satisfies(process.versions.node, nodeRange)) {
  fail("node", `unsupported Node ${process.versions.node}; expected ${nodeRange}`);
}

await checkSqlite();
await checkPty();
await checkFiles();

const report = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  npm: process.env.npm_config_user_agent ?? null,
  ok: checks.every((check) => check.ok),
  checks,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
// node-pty may retain a ConPTY handle after the probe exits; end the smoke
// process explicitly so Windows callers do not hang after a successful report.
process.exit(report.ok ? 0 : 1);
