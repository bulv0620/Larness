import "@fastify/cookie";
import { ERROR_HTTP_STATUS } from "@larness/shared";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { ENROLLMENT_COOKIE, SESSION_COOKIE, sessionCookieOptions } from "../auth/sessions.js";
import { HttpError } from "../errors.js";
import { WebAuthnError } from "../webauthn/rp.js";
import {
  authenticationOptions,
  DeviceAdminError,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
  type WebAuthnServiceOptions,
  type WebAuthnSession,
} from "../webauthn/service.js";

const VerifySchema = z
  .object({
    challengeId: z.string().min(1).max(128),
    response: z.unknown(),
  })
  .strict();

export interface WebAuthnApiDeps extends WebAuthnServiceOptions {}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function parseVerifyBody(body: unknown): {
  challengeId: string;
  response: Record<string, unknown>;
} {
  const parsed = VerifySchema.safeParse(body ?? {});

  if (!parsed.success) {
    throw new HttpError("VALIDATION_ERROR", "Invalid request");
  }

  if (
    typeof parsed.data.response !== "object" ||
    parsed.data.response === null ||
    Array.isArray(parsed.data.response)
  ) {
    throw new HttpError("VALIDATION_ERROR", "Invalid WebAuthn response");
  }

  return {
    challengeId: parsed.data.challengeId,
    response: parsed.data.response as Record<string, unknown>,
  };
}

function throwWebAuthn(error: unknown): never {
  if (error instanceof WebAuthnError) {
    throw new HttpError(error.code, error.message, {
      status: ERROR_HTTP_STATUS[error.code],
    });
  }

  if (error instanceof DeviceAdminError) {
    throw new HttpError(error.code === "NOT_FOUND" ? "NOT_FOUND" : "CONFLICT", error.message);
  }

  throw error;
}

function sessionBody(session: WebAuthnSession): Record<string, unknown> {
  return {
    clientSessionId: session.sessionId,
    deviceId: session.deviceId,
    kind: session.kind,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    csrfToken: session.csrfToken,
    capabilities: ["workspace.read", "workspace.write"],
    passkey: {
      backupEligible: session.backupEligible,
      backupState: session.backupState,
    },
  };
}

function setSessionCookie(
  reply: FastifyReply,
  deps: WebAuthnApiDeps,
  session: WebAuthnSession,
): void {
  reply.setCookie(
    SESSION_COOKIE,
    session.token,
    sessionCookieOptions(deps.config, session.expiresAt, deps.now?.()),
  );
}

export function registerWebAuthnRoutes(app: FastifyInstance, deps: WebAuthnApiDeps): void {
  app.post("/api/webauthn/registration/options", async (request) => {
    const enrollmentToken = request.cookies[ENROLLMENT_COOKIE] ?? "";

    try {
      return await registrationOptions(deps, {
        origin: firstHeader(request.headers.origin),
        enrollmentToken,
      });
    } catch (error) {
      throwWebAuthn(error);
    }
  });

  app.post("/api/webauthn/registration/verify", async (request, reply) => {
    const body = parseVerifyBody(request.body);
    const enrollmentToken = request.cookies[ENROLLMENT_COOKIE] ?? "";

    try {
      const session = await verifyRegistration(deps, {
        origin: firstHeader(request.headers.origin),
        enrollmentToken,
        challengeId: body.challengeId,
        response: body.response as unknown as RegistrationResponseJSON,
      });

      setSessionCookie(reply, deps, session);
      reply.clearCookie(ENROLLMENT_COOKIE, { path: "/api/webauthn/registration" });
      reply.code(201);
      return sessionBody(session);
    } catch (error) {
      throwWebAuthn(error);
    }
  });

  app.post("/api/webauthn/authentication/options", async (request) => {
    try {
      return await authenticationOptions(deps, {
        origin: firstHeader(request.headers.origin),
      });
    } catch (error) {
      throwWebAuthn(error);
    }
  });

  app.post("/api/webauthn/authentication/verify", async (request, reply) => {
    const body = parseVerifyBody(request.body);

    try {
      const session = await verifyAuthentication(deps, {
        origin: firstHeader(request.headers.origin),
        challengeId: body.challengeId,
        response: body.response as unknown as AuthenticationResponseJSON,
      });

      setSessionCookie(reply, deps, session);
      return sessionBody(session);
    } catch (error) {
      throwWebAuthn(error);
    }
  });
}
