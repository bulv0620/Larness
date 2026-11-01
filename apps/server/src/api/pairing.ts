import "@fastify/cookie";
import { type AppConfig, ERROR_HTTP_STATUS, type WebAuthnRuntime } from "@larness/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { ENROLLMENT_COOKIE, SESSION_COOKIE, sessionCookieOptions } from "../auth/sessions.js";
import type { Database } from "../db/client.js";
import { HttpError } from "../errors.js";
import {
  createPairingRequest,
  getPairingStatus,
  PairingError,
  redeemPairingCode,
} from "../pairing/service.js";

const CreatePairingRequestSchema = z
  .object({ clientLabel: z.string().max(100).optional() })
  .strict();

const RedeemPairingSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    code: z.string().min(1).max(64),
  })
  .strict();

export interface PairingApiDeps {
  db: Database;
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
  csrfKey: Buffer;
  now?: () => number;
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function throwHttp(error: unknown): never {
  if (error instanceof PairingError) {
    throw new HttpError(error.code, error.message, {
      status: ERROR_HTTP_STATUS[error.code],
      details: error.details,
    });
  }

  throw error;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});

  if (!parsed.success) {
    throw new HttpError("VALIDATION_ERROR", "Invalid request", {
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  return parsed.data;
}

function secureCookie(config: AppConfig): boolean {
  return (
    config.webauthn.origin.startsWith("https://") ||
    config.server.publicUrl?.startsWith("https://") === true
  );
}

function setSessionCookie(
  reply: FastifyReply,
  deps: PairingApiDeps,
  token: string,
  expiresAt: number,
): void {
  reply.setCookie(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(deps.config, expiresAt, deps.now?.()),
  );
}

function setEnrollmentCookie(
  reply: FastifyReply,
  deps: PairingApiDeps,
  token: string,
  expiresAt: number,
): void {
  reply.setCookie(ENROLLMENT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie(deps.config),
    path: "/api/webauthn/registration",
    maxAge: Math.max(1, Math.floor((expiresAt - (deps.now?.() ?? Date.now())) / 1_000)),
  });
}

export function registerPairingRoutes(app: FastifyInstance, deps: PairingApiDeps): void {
  app.post("/api/pairing/requests", async (request, reply) => {
    const body = parseBody(CreatePairingRequestSchema, request.body);

    try {
      const created = createPairingRequest(
        {
          db: deps.db,
          config: deps.config,
          webAuthn: deps.webAuthn,
          csrfKey: deps.csrfKey,
        },
        {
          clientLabel: body.clientLabel,
          clientOrigin: firstHeader(request.headers.origin),
          userAgent: firstHeader(request.headers["user-agent"]) ?? undefined,
          ip: request.ip,
          now: deps.now?.(),
        },
      );

      reply.code(201);
      return {
        requestId: created.request.id,
        shortCode: created.shortCode,
        pollToken: created.pollToken,
        expiresAt: created.expiresAt,
      };
    } catch (error) {
      throwHttp(error);
    }
  });

  app.get<{ Params: { requestId: string } }>(
    "/api/pairing/requests/:requestId",
    async (request) => {
      const pollToken = firstHeader(request.headers["x-pairing-token"]);

      if (pollToken === null) {
        throw new HttpError("NOT_FOUND", "pairing request not found");
      }

      try {
        return getPairingStatus(
          {
            db: deps.db,
            config: deps.config,
            webAuthn: deps.webAuthn,
            csrfKey: deps.csrfKey,
          },
          { requestId: request.params.requestId, pollToken, now: deps.now?.() },
        );
      } catch (error) {
        throwHttp(error);
      }
    },
  );

  app.post("/api/pairing/redeem", async (request, reply) => {
    const body = parseBody(RedeemPairingSchema, request.body);

    try {
      const result = redeemPairingCode(
        {
          db: deps.db,
          config: deps.config,
          webAuthn: deps.webAuthn,
          csrfKey: deps.csrfKey,
        },
        {
          requestId: body.requestId,
          code: body.code,
          origin: firstHeader(request.headers.origin) ?? undefined,
          ip: request.ip,
          userAgent: firstHeader(request.headers["user-agent"]) ?? undefined,
          now: deps.now?.(),
        },
      );

      if (result.kind === "session") {
        setSessionCookie(reply, deps, result.token, result.expiresAt);

        return {
          status: "session",
          clientSessionId: result.clientSessionId,
          kind: "once",
          deviceId: null,
          csrfToken: result.csrfToken,
          expiresAt: result.expiresAt,
        };
      }

      setEnrollmentCookie(reply, deps, result.token, result.expiresAt);

      return {
        status: "passkey_required",
        requestId: result.requestId,
        enrollmentExpiresAt: result.expiresAt,
      };
    } catch (error) {
      throwHttp(error);
    }
  });
}
