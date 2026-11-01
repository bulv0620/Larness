import type { AppConfig } from "@larness/shared";
import type { DbExecutor } from "../db/client.js";
import {
  createBrowserSession,
  getSessionByTokenHash,
} from "../db/repositories/browser-sessions.js";
import type { BrowserSessionRow } from "../db/schema.js";
import { generateOpaqueToken, hashToken } from "./tokens.js";

export const SESSION_COOKIE = "larness_session";
export const ENROLLMENT_COOKIE = "larness_enrollment";

export interface IssuedSession {
  session: BrowserSessionRow;
  token: string;
}

export interface IssueSessionInput {
  kind: "once" | "passkey";
  now: number;
  ttlMinutes: number;
  deviceId?: string;
  ip?: string;
  userAgent?: string;
}

export function issueSession(db: DbExecutor, input: IssueSessionInput): IssuedSession {
  const token = generateOpaqueToken();
  const session = createBrowserSession(db, {
    tokenHash: hashToken(token),
    kind: input.kind,
    createdAt: input.now,
    expiresAt: input.now + input.ttlMinutes * 60_000,
    deviceId: input.deviceId,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return { session, token };
}

export interface ResolveSessionOptions {
  now?: number;
  idleTtlMinutes?: number;
}

export function resolveActiveSession(
  db: DbExecutor,
  token: string,
  options: ResolveSessionOptions = {},
): BrowserSessionRow | null {
  if (token.length === 0) {
    return null;
  }

  const now = options.now ?? Date.now();
  const session = getSessionByTokenHash(db, hashToken(token));

  if (session === null) {
    return null;
  }

  if (session.revokedAt !== null || session.expiresAt <= now) {
    return null;
  }

  if (
    options.idleTtlMinutes !== undefined &&
    now - session.lastSeenAt > options.idleTtlMinutes * 60_000
  ) {
    return null;
  }

  return session;
}

export function sessionCookieOptions(
  config: AppConfig,
  expiresAt: number,
  now = Date.now(),
): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  const secure =
    config.webauthn.origin.startsWith("https://") ||
    config.server.publicUrl?.startsWith("https://") === true;

  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: Math.max(1, Math.floor((expiresAt - now) / 1_000)),
  };
}
