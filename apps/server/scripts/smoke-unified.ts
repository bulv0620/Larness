// Real managed dev -> built -> dev acceptance in a disposable workspace.
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_APP_CONFIG } from "@larness/shared";
import {
  type Browser,
  type BrowserContext,
  type WebSocket as BrowserSocket,
  chromium,
  type Page,
} from "@playwright/test";
import { z } from "zod";
import { openDatabase } from "../src/db/client.js";
import { touchSession } from "../src/db/repositories/browser-sessions.js";
import { connectIpc, type IpcClient } from "../src/ipc/client.js";
import { getSecretRow } from "../src/modules/models/repository.js";
import { SecretStore } from "../src/security/secretStore.js";
import type { ManagedRuntime } from "../src/tui/supervisor.js";
import { getFreePort } from "../test/helpers.js";
import { startUnifiedTlsFixture } from "./unified-tls-fixture.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "larness-unified-smoke-"));
const workspace = path.join(root, "source");
const recordDirectory = process.env.LARNESS_UNIFIED_RECORD_DIR;
let stage = "fixture preparation";
class VerificationError extends Error {}
const fakeKey = "sk-unified-test-only-never-real";
const hiddenValues = new Set<string>([fakeKey]);
function check(value: unknown, label: string): asserts value {
  if (!value) throw new VerificationError(label);
}
function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  check(result.success, label);
  return result.data;
}
async function waitFor(test: () => Promise<boolean> | boolean, label: string, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await test()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new VerificationError(label);
}
async function copyWorkspace() {
  for (const item of [
    "package.json",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
    "apps/server/src",
    "apps/server/dist",
    "apps/server/drizzle",
    "apps/server/package.json",
    "apps/web/index.html",
    "apps/web/src",
    "apps/web/scripts",
    "apps/web/public",
    "apps/web/dist",
    "apps/web/vite.config.ts",
    "apps/web/package.json",
    "packages/ui",
    "packages/shared",
  ]) {
    const destination = path.join(workspace, item);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(repo, item), destination, {
      recursive: true,
      filter: (file) => path.basename(file) !== "node_modules",
    });
  }
  for (const item of [
    "node_modules",
    "apps/server/node_modules",
    "apps/web/node_modules",
    "packages/ui/node_modules",
    "packages/shared/node_modules",
  ]) {
    await symlink(path.join(repo, item), path.join(workspace, item));
  }
}
async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}
async function pair(page: Page, client: IpcClient) {
  await page.waitForSelector('[data-request-id][data-stage="waiting"]', { timeout: 20_000 });
  const requestId = await page.locator("[data-request-id]").getAttribute("data-request-id");
  check(requestId, "pair request missing");
  const approved = parse(
    z.object({ code: z.string() }),
    await client.request("pairing.approve", { requestId, decision: "trust" }),
    "approval response",
  );
  hiddenValues.add(approved.code);
  await page.getByLabel("配对码").fill(approved.code);
  await page.getByRole("button", { name: "兑换配对码" }).click();
  await page.getByRole("button", { name: "创建 Passkey" }).click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  return approved.code;
}
async function ensureWorkspace(page: Page, origin: string) {
  await page.goto(origin);
  await waitFor(
    async () =>
      /\/(?:login|pair)$/.test(new URL(page.url()).pathname) ||
      (await page.getByTestId("workspace-home").count()) > 0,
    "auth route did not settle",
  );
  if (new URL(page.url()).pathname === "/login") {
    await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  }
  await page.getByTestId("workspace-home").waitFor({ state: "visible", timeout: 20_000 });
}
async function api(context: BrowserContext, origin: string, route: string, body?: unknown) {
  const session = await context.request.get(`${origin}/api/auth/session`);
  check(session.ok(), "authenticated session missing");
  const auth = parse(z.object({ csrfToken: z.string() }), await session.json(), "session response");
  const result =
    body === undefined
      ? await context.request.get(origin + route)
      : await context.request.post(origin + route, {
          headers: { Origin: origin, "x-csrf-token": auth.csrfToken },
          data: body,
        });
  check(result.ok(), `API failed: ${route}`);
  const text = await result.text();
  check(!text.includes(fakeKey), "credential leaked in API");
  return JSON.parse(text) as unknown;
}
async function businessSocket(page: Page, sessionId: string) {
  const result = await page.evaluate<boolean>(
    `new Promise((resolve) => { const socket = new WebSocket(location.origin.replace(/^http/,"ws")+"/ws"); window.unifiedBusiness=socket; socket.onmessage = event => { const message=JSON.parse(event.data); if(message.kind==="hello")socket.send(JSON.stringify({type:"subscribe",subscriptions:[{topic:"agent",resourceId:${JSON.stringify(sessionId)}}]})); if(message.kind==="subscribed"){window.unifiedSubscribed=true;resolve(true);} };socket.onerror=()=>resolve(false);setTimeout(()=>resolve(false),10000); })`,
  );
  check(result, "business websocket did not subscribe");
}
async function verifyMonaco(page: Page) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ok = await Promise.race([
      page.evaluate<boolean>('import("/src/unified-monaco.ts").then(module=>module.verify())'),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new VerificationError("Monaco worker timed out")), 25_000);
      }),
    ]);
    check(ok, "Monaco worker unavailable");
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    const message = error instanceof Error ? error.message : "";
    const code = /[Cc]ontext.*destroyed|navigation|navigating/.test(message)
      ? "navigation interrupted worker verification"
      : /[Ff]ailed to fetch|dynamically imported/.test(message)
        ? "worker module fetch failed"
        : /source file/.test(message)
          ? "worker model sync failed"
          : "worker RPC failed";
    let detail = message.split("\n")[0] ?? "unknown";
    for (const value of hiddenValues) detail = detail.replaceAll(value, "[redacted]");
    detail = detail
      .replace(/\?[^ "'\n]*/g, "?[redacted]")
      .replace(/nonce-[^ "']+/g, "nonce-[redacted]");
    throw new VerificationError(`${code}: ${detail.slice(0, 240)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function verifyStoredSecret(dataDir: string, ref: string, originalKey: Buffer) {
  check(
    (await readFile(path.join(dataDir, "secrets/master.key"))).equals(originalKey),
    "master key changed across modes",
  );
  const opened = openDatabase(path.join(dataDir, "larness.db"));
  try {
    const row = getSecretRow(opened.db, ref);
    check(row, "stored secret missing");
    const store = await SecretStore.open(dataDir, [row]);
    check(store.decrypt(row) === fakeKey, "stored credential cannot decrypt");
  } finally {
    opened.close();
  }
}
async function verifyLegacy(load: typeof import("../src/tui/supervisor.js")) {
  stage = "legacy configuration";
  const directory = path.join(root, "legacy");
  await mkdir(directory);
  const port = await getFreePort();
  let oldPort = await getFreePort();
  while (oldPort === port) oldPort = await getFreePort();
  const config = structuredClone(DEFAULT_APP_CONFIG);
  config.server.port = oldPort;
  config.server.publicUrl = `http://localhost:${port}`;
  const file = path.join(directory, "config.json");
  const initial = JSON.stringify(config);
  await writeFile(file, initial, { mode: 0o600 });
  process.env.LARNESS_DATA_DIR = directory;
  for (const dev of [true, false]) {
    let rejected = false;
    try {
      const unexpected = await load.startManagedRuntime({ dev, out: () => undefined });
      await unexpected.stop();
    } catch (error) {
      rejected = error instanceof Error && error.message.includes("server.port");
    }
    check(rejected, "legacy mismatch was not rejected with an actionable instruction");
    check((await readFile(file, "utf8")) === initial, "legacy config was silently changed");
    check((await readdir(directory)).length === 1, "legacy rejection created runtime data");
  }
  config.server.port = port;
  await writeFile(file, JSON.stringify(config), { mode: 0o600 });
  for (const dev of [true, false]) {
    const runtime = await load.startManagedRuntime({ dev, out: () => undefined });
    try {
      check(runtime.webUrl === config.server.publicUrl, "legacy aligned address changed");
      const client = await connectIpc({ dataDir: directory, client: "unified-smoke" });
      try {
        const init = parse(
          z.object({ initialized: z.boolean() }),
          await client.request("init.status"),
          "init status",
        );
        if (!init.initialized) await client.request("init.apply", {});
      } finally {
        client.close();
      }
    } finally {
      await runtime.stop();
    }
  }
  console.log(
    "PASS legacy config: rejected without mutation, one-time alignment works in both modes",
  );
}

async function runSequence(
  browser: Browser,
  load: typeof import("../src/tui/supervisor.js"),
  dataDir: string,
  origin: string,
  modes: boolean[] = [true, false, true],
  tls = false,
) {
  const context = await browser.newContext({ ignoreHTTPSErrors: tls });
  const page = await context.newPage();
  await virtualAuthenticator(page);
  const violations: string[] = [];
  let hmrConnected = false;
  let lastHmr: BrowserSocket | undefined;
  const socketOrigins: string[] = [];
  await page.exposeFunction("unifiedCsp", (directive: string) => violations.push(directive));
  await page.addInitScript(
    'document.addEventListener("securitypolicyviolation", event=>window.unifiedCsp(event.violatedDirective));',
  );
  page.on("websocket", (socket) => {
    const url = new URL(socket.url());
    socketOrigins.push(url.origin);
    if (url.pathname === "/_larness/dev/hmr") {
      socket.on("framereceived", (event) => {
        try {
          const value = JSON.parse(String(event.payload));
          if (z.object({ type: z.literal("connected") }).safeParse(value).success) {
            hmrConnected = true;
            lastHmr = socket;
          }
        } catch {}
      });
    }
  });
  let runtime: ManagedRuntime | undefined;
  let client: IpcClient | undefined;
  let pairCode = "";
  let projectId = "";
  let sessionId = "";
  let credentialId = "";
  let secretRef = "";
  let deviceId = "";
  let originalKey = Buffer.alloc(0);
  try {
    for (const [index, dev] of modes.entries()) {
      hmrConnected = false;
      process.env.LARNESS_DATA_DIR = dataDir;
      stage = `startup ${index + 1}/${modes.length}`;
      const nodeOptions = process.env.NODE_OPTIONS;
      if (!dev)
        process.env.NODE_OPTIONS = `${nodeOptions ?? ""} --import=${pathToFileURL(path.join(root, "deny-vite.mjs")).href}`;
      try {
        runtime = await load.startManagedRuntime({ dev, out: () => undefined });
      } finally {
        if (nodeOptions === undefined) delete process.env.NODE_OPTIONS;
        else process.env.NODE_OPTIONS = nodeOptions;
      }
      check(runtime.webUrl === origin, "public address changed across modes");
      client = await connectIpc({ dataDir, client: "unified-smoke" });
      if (index === 0) {
        await client.request("init.apply", {});
        await page.goto(origin);
        stage = "pair and Passkey registration";
        pairCode = await pair(page, client);
      }
      stage = `workspace ${index + 1}/${modes.length}`;
      if (index === 1 && !tls)
        check(
          (await context.request.get(`${origin}/api/auth/session`)).status() === 401,
          "idle-expired session was revived by a mode switch",
        );
      await ensureWorkspace(page, origin);
      const authResponse = await context.request.get(`${origin}/api/auth/session`);
      const auth = parse(
        z.object({ deviceId: z.string(), clientSessionId: z.string() }),
        await authResponse.json(),
        "missing trusted device",
      );
      if (index === 0) {
        deviceId = auth.deviceId;
        const project = await api(context, origin, "/api/projects", {
          rootPath: path.join(root, "project"),
          name: "Unified fixture",
        });
        projectId = parse(z.object({ id: z.string() }), project, "project response").id;
        sessionId = parse(
          z.object({ id: z.string() }),
          await api(context, origin, "/api/sessions", { projectId, title: "Unified session" }),
          "workspace session response",
        ).id;
        const credential = parse(
          z.object({ id: z.string(), secretRef: z.string() }),
          await api(context, origin, "/api/credentials", {
            provider: "deepseek",
            label: "Unified fixture",
            apiKey: fakeKey,
          }),
          "credential response",
        );
        credentialId = credential.id;
        secretRef = credential.secretRef;
        originalKey = await readFile(path.join(dataDir, "secrets/master.key"));
      }
      check(auth.deviceId === deviceId, "trusted device changed");
      if (index > 0) {
        await page.getByTestId("logout-button").click();
        await page.waitForURL((url) => url.pathname === "/login");
        await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
        await page.getByTestId("workspace-home").waitFor({ state: "visible", timeout: 20_000 });
      }
      const projects = parse(
        z.object({ projects: z.array(z.object({ id: z.string() })) }),
        await api(context, origin, "/api/projects"),
        "projects response",
      );
      check(
        projects.projects.some((item) => item.id === projectId),
        "project lost across modes",
      );
      const sessions = parse(
        z.object({ sessions: z.array(z.object({ id: z.string() })) }),
        await api(context, origin, "/api/sessions"),
        "sessions response",
      );
      check(
        sessions.sessions.some((item) => item.id === sessionId),
        "session lost across modes",
      );
      const credentials = parse(
        z.object({ credentials: z.array(z.object({ id: z.string() })) }),
        await api(context, origin, "/api/credentials"),
        "credentials response",
      );
      check(
        credentials.credentials.some((item) => item.id === credentialId),
        "credential lost across modes",
      );
      if (index === 0 && !tls) {
        stage = "single-instance lock";
        const alternate = await getFreePort();
        process.env.LARNESS_PORT = String(alternate);
        let rejected = false;
        try {
          const extra = await load.startManagedRuntime({ dev: true, out: () => undefined });
          await extra.stop();
        } catch {
          rejected = true;
        } finally {
          delete process.env.LARNESS_PORT;
        }
        check(rejected, "same-directory concurrent startup was accepted");
        check(
          (await context.request.get(`${origin}/api/health`)).ok(),
          "existing instance was stopped by rejected startup",
        );
      }
      await businessSocket(page, sessionId);
      if (dev) {
        await waitFor(() => hmrConnected, "HMR connection missing");
        stage = "Monaco worker";
        await verifyMonaco(page);
        if (index === 2) {
          stage = "real HMR";
          await page.evaluate('window.unifiedSentinel="preserved"');
          const file = path.join(workspace, "apps/web/src/features/workspace/WorkspaceHome.tsx");
          const text = await readFile(file, "utf8");
          check(text.includes('data-unified-hmr="before"'), "HMR fixture missing");
          await writeFile(
            file,
            text.replace('data-unified-hmr="before"', 'data-unified-hmr="after"'),
          );
          await waitFor(
            async () =>
              (await page.locator("[data-unified-hmr]").getAttribute("data-unified-hmr")) ===
              "after",
            "HMR did not update the mounted component",
          );
          check(
            await page.evaluate<boolean>('window.unifiedSentinel==="preserved"'),
            "HMR unexpectedly reloaded the document",
          );
          check(
            await page.evaluate<boolean>("window.unifiedBusiness.readyState===WebSocket.OPEN"),
            "HMR disrupted business WS",
          );
        }
      } else {
        const response = await context.request.get(`${origin}/@vite/client`);
        check(response.status() === 404, "production served development client");
      }
      check(violations.length === 0, `CSP violations in ${dev ? "dev" : "built"} mode`);
      check(
        socketOrigins.every((value) => value === origin.replace(/^http/, "ws")),
        "browser connected to an internal address",
      );
      if (recordDirectory) {
        await mkdir(recordDirectory, { recursive: true });
        await page.screenshot({
          path: path.join(
            recordDirectory,
            `${tls ? "https" : "http"}-${index + 1}-${dev ? "dev" : "built"}.png`,
          ),
        });
      }
      if (index === 2 && dev) {
        stage = "real revocation";
        const activeHmr = lastHmr;
        check(activeHmr, "active HMR missing");
        await client.request("devices.revoke", { deviceId });
        await waitFor(() => activeHmr.isClosed(), "revocation did not close HMR");
        await waitFor(
          async () =>
            page.evaluate<boolean>(
              "!window.unifiedBusiness || window.unifiedBusiness.readyState===WebSocket.CLOSED",
            ),
          "revocation did not close business WS",
        );
        check(
          (await context.request.get(`${origin}/api/auth/session`)).status() === 401,
          "revoked session still authenticates",
        );
      }
      client.close();
      client = undefined;
      await runtime.stop();
      runtime = undefined;
      await verifyStoredSecret(dataDir, secretRef, originalKey);
      if (index === 0 && !tls) {
        const opened = openDatabase(path.join(dataDir, "larness.db"));
        try {
          touchSession(opened.db, auth.clientSessionId, Date.now() - 31 * 60_000);
        } finally {
          opened.close();
        }
      }
      console.log(
        `PASS ${tls ? "HTTPS" : "HTTP"} same-directory ${index + 1}/${modes.length}: ${dev ? "dev" : "built"}, Passkey/data/key/WS/CSP preserved`,
      );
    }
    const logs = (
      await Promise.all(
        (
          await readdir(path.join(dataDir, "logs"))
        )
          .filter((name) => name.endsWith(".log"))
          .map((name) => readFile(path.join(dataDir, "logs", name), "utf8")),
      )
    ).join("\n");
    check(!logs.includes(fakeKey) && !logs.includes(pairCode), "secret leaked into logs");
  } finally {
    client?.close();
    await context.close();
    await runtime?.stop();
  }
}

const originalEnv = { ...process.env };
let browser: Browser | undefined;
try {
  for (const key of Object.keys(process.env))
    if (key.startsWith("LARNESS_")) delete process.env[key];
  await writeFile(
    path.join(root, "deny-vite.mjs"),
    `import { register } from "node:module";
register("data:text/javascript,"+encodeURIComponent('export async function resolve(specifier,context,next){if(specifier==="vite"||specifier.startsWith("vite/")||specifier.replaceAll(String.fromCharCode(92),"/").includes("/node_modules/vite/"))throw new Error("Vite unavailable in packaged acceptance");return next(specifier,context);}'),import.meta.url);`,
  );
  await copyWorkspace();
  await mkdir(path.join(root, "project"));
  const home = path.join(workspace, "apps/web/src/features/workspace/WorkspaceHome.tsx");
  const source = await readFile(home, "utf8");
  check(source.includes("return <AppShell version={version} />;"), "workspace fixture changed");
  await writeFile(
    home,
    source.replace(
      "return <AppShell version={version} />;",
      'return <div data-unified-hmr="before"><AppShell version={version} /></div>;',
    ),
  );
  await writeFile(
    path.join(workspace, "apps/web/src/unified-monaco.ts"),
    'import "./lib/monaco";import * as monaco from "monaco-editor";export async function verify(){const node=document.createElement("div");node.style.cssText="height:120px;width:300px";document.body.append(node);const model=monaco.editor.createModel("const count: number = 1;","typescript");const editor=monaco.editor.create(node,{model});try{const deadline=Date.now()+10000;let worker;while(!worker){try{worker=await monaco.typescript.getTypeScriptWorker();}catch(error){if(error!=="TypeScript not registered!"||Date.now()>deadline)throw error;await new Promise(done=>setTimeout(done,50));}}const client=await worker(model.uri);return (await client.getSyntacticDiagnostics(model.uri.toString())).length===0;}finally{editor.dispose();model.dispose();node.remove();}}',
  );
  const supervisor = (await import(
    pathToFileURL(path.join(workspace, "apps/server/src/tui/supervisor.ts")).href
  )) as typeof import("../src/tui/supervisor.js");
  const port = await getFreePort();
  const dataDir = path.join(root, "data");
  await mkdir(dataDir);
  const config = structuredClone(DEFAULT_APP_CONFIG);
  config.server.port = port;
  await writeFile(path.join(dataDir, "config.json"), JSON.stringify(config), { mode: 0o600 });
  browser = await chromium.launch({ headless: true });
  await runSequence(browser, supervisor, dataDir, `http://localhost:${port}`);
  stage = "HTTPS fixture";
  const tlsServerPort = await getFreePort();
  const tlsProxy = await startUnifiedTlsFixture(root, tlsServerPort);
  try {
    const tlsData = path.join(root, "tls-data");
    await mkdir(tlsData);
    const tlsConfig = structuredClone(DEFAULT_APP_CONFIG);
    tlsConfig.server.port = tlsServerPort;
    tlsConfig.server.publicUrl = tlsProxy.origin;
    tlsConfig.server.trustedProxies = ["127.0.0.1", "::1"];
    await writeFile(path.join(tlsData, "config.json"), JSON.stringify(tlsConfig), { mode: 0o600 });
    await runSequence(browser, supervisor, tlsData, tlsProxy.origin, [true, false], true);
  } finally {
    await tlsProxy.close();
  }
  await verifyLegacy(supervisor);
  console.log("PASS unified entry real browser acceptance");
} catch (error) {
  console.error(
    error instanceof VerificationError
      ? `FAIL ${stage}: ${error.message}`
      : `FAIL ${stage}: diagnostic withheld to protect pairing material`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await rm(root, { recursive: true, force: true });
  for (const key of Object.keys(process.env))
    if (key.startsWith("LARNESS_")) delete process.env[key];
  Object.assign(process.env, originalEnv);
}
