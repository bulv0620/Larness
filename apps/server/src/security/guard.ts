import { type AppConfig, ERROR_HTTP_STATUS, type WebAuthnRuntime } from "@larness/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { APP_CSP } from "../api/static.js";
import { verifyCsrfToken } from "../auth/csrf.js";
import { isInitialized } from "../auth/initialized.js";
import { resolveActiveSession, SESSION_COOKIE } from "../auth/sessions.js";
import { hashToken } from "../auth/tokens.js";
import type { Database } from "../db/client.js";
import { appendAudit } from "../db/repositories/audit.js";
import { touchSession } from "../db/repositories/browser-sessions.js";
import { HttpError } from "../errors.js";
import { RateLimiter } from "./rate-limit.js";
import { transportAllowed } from "./transport.js";

export interface SecurityGuardDeps {
  db: Database;
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
  csrfKey: Buffer;
  limiter?: RateLimiter;
  now?: () => number;
}

const RATE_WINDOW_MS = 60_000;
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function readCookie(header: string | undefined, name: string): string {
  if (header === undefined) {
    return "";
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }

  return "";
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function hostAllowed(hostHeader: string | undefined, webAuthn: WebAuthnRuntime): boolean {
  if (hostHeader === undefined || hostHeader.length === 0) {
    return false;
  }

  let host: URL;

  try {
    host = new URL(`http://${hostHeader}`);
  } catch {
    return false;
  }

  const canonical = new URL(webAuthn.origin);

  if (host.hostname === canonical.hostname) {
    return true;
  }

  return canonical.hostname === "localhost" && isLoopbackHostname(host.hostname);
}

function originAllowed(origin: string | undefined, webAuthn: WebAuthnRuntime): boolean {
  if (origin === undefined || origin.length === 0) {
    return false;
  }

  if (origin === webAuthn.origin) {
    return true;
  }

  let parsed: URL;

  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  if (!isLoopbackHostname(parsed.hostname)) {
    return false;
  }

  const canonical = new URL(webAuthn.origin);
  const canonicalPort = canonical.port || (canonical.protocol === "https:" ? "443" : "80");
  const originPort = parsed.port || (parsed.protocol === "https:" ? "443" : "80");

  return originPort === canonicalPort;
}

function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/api/bootstrap" ||
    pathname.startsWith("/api/pairing/") ||
    pathname.startsWith("/api/webauthn/")
  );
}

function rateScope(request: FastifyRequest): { scope: string; key: string; limit: number } | null {
  const pathname = (request.url.split("?")[0] ?? request.url).replace(/\/$/, "");
  const method = request.method;

  if (pathname === "/api/pairing/requests" && method === "POST") {
    return { scope: "pairing.create", key: request.ip, limit: 10 };
  }

  if (pathname.startsWith("/api/pairing/requests/") && method === "GET") {
    const pollToken = request.headers["x-pairing-token"];
    const token = Array.isArray(pollToken) ? pollToken[0] : pollToken;
    return {
      scope: "pairing.poll",
      key: token === undefined ? request.ip : hashToken(token),
      limit: 60,
    };
  }

  if (pathname === "/api/pairing/redeem" && method === "POST") {
    return { scope: "pairing.redeem", key: request.ip, limit: 10 };
  }

  if (pathname.startsWith("/api/webauthn/") && method === "POST") {
    return { scope: "webauthn", key: request.ip, limit: 10 };
  }

  return null;
}

export function installSecurityGuard(app: FastifyInstance, deps: SecurityGuardDeps): void {
  const limiter = deps.limiter ?? new RateLimiter();
  const now = deps.now ?? Date.now;

  app.decorateRequest("clientSession", null);

  app.addHook("onRequest", async (request) => {
    const pathname = request.url.split("?")[0] ?? request.url;

    if (
      !pathname.startsWith("/api/") ||
      pathname === "/api/health" ||
      pathname === "/api/init" ||
      pathname.startsWith("/api/init/")
    ) {
      return;
    }

    if (!hostAllowed(request.headers.host, deps.webAuthn)) {
      throw new HttpError("ORIGIN_INVALID", "Host is not allowed");
    }

    if (!transportAllowed(request, deps.config.auth)) {
      throw new HttpError("HTTPS_REQUIRED", "HTTPS is required for remote access");
    }

    const mutating = MUTATING_METHODS.has(request.method);

    if (mutating && !originAllowed(request.headers.origin, deps.webAuthn)) {
      throw new HttpError("ORIGIN_INVALID", "Origin is not allowed");
    }

    const publicRoute = isPublicPath(pathname);
    const scope = rateScope(request);

    if (scope !== null) {
      const decision = limiter.consume(
        `${scope.scope}:${scope.key}`,
        scope.limit,
        RATE_WINDOW_MS,
        now(),
      );

      if (!decision.allowed) {
        try {
          appendAudit(deps.db, {
            action: "security.rate_limited",
            decision: "deny",
            details: { scope: scope.scope },
            now: now(),
          });
        } catch {
          // Rate limiting still applies if audit storage is unavailable.
        }

        throw new HttpError("RATE_LIMITED", "Too many requests", {
          status: ERROR_HTTP_STATUS.RATE_LIMITED,
          details: { retryAfterMs: decision.retryAfterMs },
        });
      }
    }

    if (publicRoute) {
      return;
    }

    if (!isInitialized(deps.db)) {
      throw new HttpError("NOT_INITIALIZED", "Workspace is not initialized");
    }

    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
    const timestamp = now();
    const session = resolveActiveSession(deps.db, token, {
      now: timestamp,
      idleTtlMinutes: deps.config.auth.idleTtlMinutes,
    });

    if (session === null) {
      throw new HttpError("UNAUTHENTICATED", "Authentication required");
    }

    request.clientSession = session;

    if (mutating) {
      const csrf = request.headers["x-csrf-token"];
      const csrfToken = Array.isArray(csrf) ? csrf[0] : csrf;

      if (csrfToken === undefined || !verifyCsrfToken(csrfToken, session.id, deps.csrfKey)) {
        throw new HttpError("CSRF_INVALID", "CSRF token is invalid");
      }
    }

    const passivePoll =
      (request.method === "GET" && pathname === "/api/auth/session") ||
      (request.method === "GET" && pathname === "/api/bootstrap");

    if (!passivePoll && timestamp - session.lastSeenAt >= 60_000) {
      touchSession(deps.db, session.id, timestamp);
    }

    const sessionDecision = limiter.consume(
      `session:${session.id}`,
      600,
      RATE_WINDOW_MS,
      timestamp,
    );

    if (!sessionDecision.allowed) {
      try {
        appendAudit(deps.db, {
          action: "security.rate_limited",
          decision: "deny",
          details: { scope: "session" },
          now: now(),
        });
      } catch {
        // Rate limiting still applies if audit storage is unavailable.
      }

      throw new HttpError("RATE_LIMITED", "Too many requests", {
        status: ERROR_HTTP_STATUS.RATE_LIMITED,
      });
    }
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");

    reply.header(
      "content-security-policy",
      request.url.startsWith("/api/") ? "default-src 'none'; frame-ancestors 'none'" : APP_CSP,
    );

    return payload;
  });
}
