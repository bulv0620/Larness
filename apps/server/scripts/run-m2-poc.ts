// Source + copied-dependency built-artifact validation, all artifacts in OS tmp.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "tsdown";
import { z } from "zod";

const exec = promisify(execFile);
const server = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const root = await mkdtemp(path.join(tmpdir(), "larness-m2-built-"));
const reportSchema = z.object({
  node: z.string(),
  abi: z.string(),
  os: z.string(),
  release: z.string(),
  arch: z.string(),
  native: z.object({ version: z.literal("1.1.0"), license: z.literal("MIT") }),
  results: z.record(z.string(), z.record(z.string(), z.literal(true))),
});
try {
  const source = await exec(
    process.execPath,
    [
      require.resolve("tsx/cli"),
      path.join(server, "scripts/m2-poc/cli.ts"),
      path.join(server, "drizzle"),
    ],
    { cwd: server, timeout: 60_000, maxBuffer: 65_536 },
  );
  const sourceReport = reportSchema.parse(JSON.parse(source.stdout.trim()));
  process.stdout.write(`SOURCE ${JSON.stringify(sourceReport)}\n`);
  await build({
    config: false,
    entry: { "m2-poc": path.join(server, "scripts/m2-poc/cli.ts") },
    outDir: path.join(root, "dist"),
    format: "esm",
    platform: "node",
    dts: false,
    clean: true,
    outExtensions: () => ({ js: ".js" }),
    deps: {
      alwaysBundle: [/^@larness\//, /^drizzle-orm/, "zod", "diff"],
      neverBundle: ["node-pty", "better-sqlite3"],
    },
  });
  await cp(path.join(server, "package.json"), path.join(root, "package.json"));
  await cp(path.join(server, "drizzle"), path.join(root, "drizzle"), { recursive: true });
  await mkdir(path.join(root, "node_modules"));
  const sqliteRequire = createRequire(require.resolve("better-sqlite3/package.json"));
  const bindingsRequire = createRequire(sqliteRequire.resolve("bindings/package.json"));
  for (const [name, resolver] of [
    ["node-pty", require],
    ["better-sqlite3", require],
    ["bindings", sqliteRequire],
    ["file-uri-to-path", bindingsRequire],
  ] as const) {
    await cp(
      path.dirname(resolver.resolve(`${name}/package.json`)),
      path.join(root, "node_modules", name),
      {
        recursive: true,
        filter: (item) => path.basename(item) !== "node_modules",
      },
    );
  }
  const nativeRoot = path.join(root, "node_modules", "node-pty");
  if (process.platform === "darwin") {
    assert(
      (await stat(path.join(nativeRoot, "prebuilds", `darwin-${process.arch}`, "spawn-helper")))
        .mode & 0o100,
    );
  }
  const bundle = await readFile(path.join(root, "dist", "m2-poc.js"), "utf8");
  assert(!bundle.includes(server), "built artifact must not import server source paths");
  const built = await exec(
    process.execPath,
    [path.join(root, "dist", "m2-poc.js"), path.join(root, "drizzle")],
    {
      cwd: root,
      timeout: 60_000,
      maxBuffer: 65_536,
    },
  );
  const builtReport = reportSchema.parse(JSON.parse(built.stdout.trim()));
  assert.deepEqual(builtReport.results, sourceReport.results);
  process.stdout.write(`BUILT ${JSON.stringify(builtReport)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
  process.stdout.write("M2-0 temporary artifacts removed\n");
}
