import { startServer } from "../../src/bootstrap/start.js";
import { connectIpc } from "../../src/ipc/client.js";
import type { ProviderResolver } from "../../src/modules/agent/turnRunner.js";
import { createLogSink, getFreePort, testConfig, writeConfig } from "../helpers.js";

function cookieValue(header: string, name: string): string {
  return new RegExp(`${name}=([^;]+)`).exec(header)?.[1] ?? "";
}

function setCookieHeader(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join("; ") : (value ?? "");
}

export interface AuthorizedServer {
  running: Awaited<ReturnType<typeof startServer>>;
  client: Awaited<ReturnType<typeof connectIpc>>;
  port: number;
  origin: string;
  cookie: string;
  csrf: string;
}

export async function startAuthorizedServer(
  dir: string,
  options: {
    turnRunner?: boolean;
    providerResolver?: ProviderResolver;
    preview?: { enabled: boolean; port?: number };
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<AuthorizedServer> {
  if (options.preview) {
    await writeConfig(dir, testConfig({ preview: options.preview }));
  }
  const port = await getFreePort();
  const origin = `http://localhost:${port}`;
  const running = await startServer({
    env: { LARNESS_DATA_DIR: dir, LARNESS_PORT: String(port), ...options.env },
    logDestination: createLogSink().stream,
    turnRunner: options.turnRunner ?? false,
    ...(options.providerResolver === undefined
      ? {}
      : { providerResolver: options.providerResolver }),
  });
  const client = await connectIpc({ dataDir: dir, client: "tui" });

  await client.request("init.apply", {
    host: "127.0.0.1",
    port,
    publicUrl: null,
    channel: "stable",
  });

  const created = (
    await running.app.inject({
      method: "POST",
      url: "/api/pairing/requests",
      headers: { origin },
      payload: {},
    })
  ).json() as { requestId: string };
  const approved = (await client.request("pairing.approve", {
    requestId: created.requestId,
    decision: "allow_once",
  })) as { code: string };
  const redeem = await running.app.inject({
    method: "POST",
    url: "/api/pairing/redeem",
    headers: { origin },
    payload: { requestId: created.requestId, code: approved.code },
  });
  const body = redeem.json() as { csrfToken: string };
  const cookie = setCookieHeader(redeem.headers["set-cookie"]);

  return {
    running,
    client,
    port,
    origin,
    cookie: `larness_session=${cookieValue(cookie, "larness_session")}`,
    csrf: body.csrfToken,
  };
}

export async function stopAuthorizedServer(started: AuthorizedServer): Promise<void> {
  started.client.close();
  await started.running.shutdown("test");
}
