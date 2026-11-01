import type { AppConfig, WebAuthnRuntime } from "@larness/shared";
import { csrfTokenFor } from "../auth/csrf.js";
import { isInitialized } from "../auth/initialized.js";
import { issueSession } from "../auth/sessions.js";
import { generateOpaqueToken, hashToken, tokenMatchesHash } from "../auth/tokens.js";
import type { Database, DbExecutor } from "../db/client.js";
import { appendAudit } from "../db/repositories/audit.js";
import {
  createDeviceRequest,
  getDeviceRequestById,
  listDeviceRequests,
  updateDeviceRequest,
} from "../db/repositories/device-requests.js";
import type { DeviceRequestRow, DeviceRequestStatus } from "../db/schema.js";
import { immediateTransaction } from "../db/transaction.js";
import {
  ENROLLMENT_TTL_MS,
  generatePairingCode,
  generateShortCode,
  normalizePairingCode,
  PAIRING_CODE_MAX_ATTEMPTS,
  PAIRING_CODE_TTL_MS,
  PAIRING_REQUEST_TTL_MS,
} from "./code.js";

export type PairingErrorCode =
  | "NOT_INITIALIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAIRING_DENIED"
  | "PAIRING_EXPIRED"
  | "CODE_INVALID"
  | "RATE_LIMITED"
  | "WEBAUTHN_NOT_CONFIGURED"
  | "ORIGIN_INVALID";

export class PairingError extends Error {
  readonly code: PairingErrorCode;
  readonly details?: { attemptsLeft: number };

  constructor(code: PairingErrorCode, message: string, details?: { attemptsLeft: number }) {
    super(message);
    this.name = "PairingError";
    this.code = code;
    this.details = details;
  }
}

export interface PairingServiceOptions {
  db: Database;
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
  csrfKey: Buffer;
}

export interface CreatePairingRequestInput {
  clientLabel?: string;
  clientOrigin: string | null;
  userAgent?: string;
  ip?: string;
  now?: number;
}

export interface CreatedPairingRequest {
  request: DeviceRequestRow;
  shortCode: string;
  pollToken: string;
  expiresAt: number;
}

export interface PairingStatusResult {
  status: DeviceRequestStatus;
  decision: DeviceRequestRow["decision"];
  expiresAt: number;
}

export interface ApprovePairingInput {
  requestId: string;
  decision: "allow_once" | "trust";
  now?: number;
}

export interface ApprovedPairing {
  code: string;
  expiresAt: number;
}

export interface RedeemPairingInput {
  requestId: string;
  code: string;
  origin?: string;
  ip?: string;
  userAgent?: string;
  now?: number;
}

export type RedeemPairingResult =
  | {
      kind: "session";
      requestId: string;
      clientSessionId: string;
      token: string;
      csrfToken: string;
      expiresAt: number;
    }
  | {
      kind: "enrollment";
      requestId: string;
      token: string;
      expiresAt: number;
    };

function isUniqueConstraint(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "SQLITE_CONSTRAINT_UNIQUE";
}

function requireInitialized(db: Database): void {
  if (!isInitialized(db)) {
    throw new PairingError("NOT_INITIALIZED", "workspace is not initialized");
  }
}

function requireRequest(db: DbExecutor, requestId: string): DeviceRequestRow {
  const request = getDeviceRequestById(db, requestId);

  if (request === null) {
    throw new PairingError("NOT_FOUND", "pairing request not found");
  }

  return request;
}

export function createPairingRequest(
  options: PairingServiceOptions,
  input: CreatePairingRequestInput,
): CreatedPairingRequest {
  requireInitialized(options.db);

  const now = input.now ?? Date.now();
  const pollToken = generateOpaqueToken();
  const pollTokenHash = hashToken(pollToken);
  const expiresAt = now + PAIRING_REQUEST_TTL_MS;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shortCode = generateShortCode();

    try {
      const request = immediateTransaction(options.db, (tx) => {
        const row = createDeviceRequest(tx, {
          shortCode,
          pollTokenHash,
          createdAt: now,
          expiresAt,
          clientLabel: input.clientLabel,
          clientOrigin: input.clientOrigin ?? undefined,
          userAgent: input.userAgent,
          ip: input.ip,
        });

        appendAudit(tx, {
          action: "pairing.requested",
          decision: "info",
          resourceType: "device_request",
          resourceId: row.id,
          details: {
            origin: input.clientOrigin,
            label: input.clientLabel,
          },
          now,
        });

        return row;
      });

      return { request, shortCode, pollToken, expiresAt };
    } catch (error) {
      if (!isUniqueConstraint(error)) {
        throw error;
      }
    }
  }

  throw new PairingError("CONFLICT", "could not allocate a unique pairing short code");
}

export function getPairingStatus(
  options: PairingServiceOptions,
  input: { requestId: string; pollToken: string; now?: number },
): PairingStatusResult {
  const request = requireRequest(options.db, input.requestId);

  if (!tokenMatchesHash(input.pollToken, request.pollTokenHash)) {
    throw new PairingError("NOT_FOUND", "pairing request not found");
  }

  const now = input.now ?? Date.now();
  let status = request.status;

  if (status === "pending" || status === "approved") {
    const codeExpired =
      status === "approved" && request.codeExpiresAt !== null && request.codeExpiresAt <= now;

    if (request.expiresAt <= now || codeExpired) {
      updateDeviceRequest(options.db, request.id, { status: "expired" });
      status = "expired";
    }
  }

  return {
    status,
    decision: status === "approved" ? request.decision : null,
    expiresAt: request.expiresAt,
  };
}

export function approvePairingRequest(
  options: PairingServiceOptions,
  input: ApprovePairingInput,
): ApprovedPairing {
  const now = input.now ?? Date.now();

  const outcome = immediateTransaction(options.db, (tx) => {
    const request = requireRequest(tx, input.requestId);

    if (request.expiresAt <= now) {
      updateDeviceRequest(tx, request.id, { status: "expired" });
      return { kind: "expired" as const };
    }

    if (request.status !== "pending") {
      throw new PairingError("CONFLICT", "pairing request is no longer pending");
    }

    if (input.decision === "trust") {
      if (!options.webAuthn.enabled) {
        throw new PairingError("WEBAUTHN_NOT_CONFIGURED", "WebAuthn is not configured");
      }

      if (request.clientOrigin === null || request.clientOrigin !== options.webAuthn.origin) {
        throw new PairingError("ORIGIN_INVALID", "pairing origin cannot use trusted enrollment");
      }
    }

    const code = generatePairingCode();
    const codeExpiresAt = now + PAIRING_CODE_TTL_MS;

    updateDeviceRequest(tx, request.id, {
      status: "approved",
      decision: input.decision,
      codeHash: hashToken(code),
      codeExpiresAt,
      decidedAt: now,
    });

    appendAudit(tx, {
      action: "pairing.approved",
      decision: "allow",
      resourceType: "device_request",
      resourceId: request.id,
      details: { decision: input.decision, origin: request.clientOrigin },
      now,
    });

    return { kind: "approved" as const, code, expiresAt: codeExpiresAt };
  });

  if (outcome.kind === "expired") {
    throw new PairingError("PAIRING_EXPIRED", "pairing request expired");
  }

  return { code: outcome.code, expiresAt: outcome.expiresAt };
}

export function denyPairingRequest(
  options: PairingServiceOptions,
  input: { requestId: string; now?: number },
): void {
  const now = input.now ?? Date.now();

  const outcome = immediateTransaction(options.db, (tx) => {
    const request = requireRequest(tx, input.requestId);

    if (request.expiresAt <= now) {
      updateDeviceRequest(tx, request.id, { status: "expired" });
      return { kind: "expired" as const };
    }

    if (request.status !== "pending") {
      throw new PairingError("CONFLICT", "pairing request is no longer pending");
    }

    updateDeviceRequest(tx, request.id, { status: "denied", decidedAt: now });

    appendAudit(tx, {
      action: "pairing.denied",
      decision: "deny",
      resourceType: "device_request",
      resourceId: request.id,
      now,
    });

    return { kind: "denied" as const };
  });

  if (outcome.kind === "expired") {
    throw new PairingError("PAIRING_EXPIRED", "pairing request expired");
  }
}

type RedeemOutcome =
  | { kind: "session"; sessionId: string; token: string; csrfToken: string; expiresAt: number }
  | { kind: "enrollment"; token: string; expiresAt: number }
  | { kind: "invalid"; attemptsLeft: number }
  | { kind: "expired" }
  | { kind: "rate_limited" };

export function redeemPairingCode(
  options: PairingServiceOptions,
  input: RedeemPairingInput,
): RedeemPairingResult {
  requireInitialized(options.db);

  const now = input.now ?? Date.now();
  const normalized = normalizePairingCode(input.code);

  const outcome = immediateTransaction(options.db, (tx): RedeemOutcome => {
    const request = requireRequest(tx, input.requestId);

    if (request.attempts >= PAIRING_CODE_MAX_ATTEMPTS) {
      appendAudit(tx, {
        action: "security.rate_limited",
        decision: "deny",
        resourceType: "device_request",
        resourceId: request.id,
        now,
      });
      return { kind: "rate_limited" };
    }

    if (request.status === "denied") {
      throw new PairingError("PAIRING_DENIED", "pairing request was denied");
    }

    if (request.status === "redeemed" || request.status === "enrollment_pending") {
      throw new PairingError("CONFLICT", "pairing request has already been redeemed");
    }

    if (request.status === "expired" || request.expiresAt <= now) {
      updateDeviceRequest(tx, request.id, { status: "expired" });
      return { kind: "expired" };
    }

    if (
      request.status !== "approved" ||
      request.codeHash === null ||
      request.codeExpiresAt === null
    ) {
      throw new PairingError("CONFLICT", "pairing request is not approved");
    }

    if (request.codeExpiresAt <= now) {
      updateDeviceRequest(tx, request.id, { status: "expired" });
      return { kind: "expired" };
    }

    if (!tokenMatchesHash(normalized, request.codeHash)) {
      const attempts = request.attempts + 1;
      const attemptsLeft = Math.max(0, PAIRING_CODE_MAX_ATTEMPTS - attempts);

      updateDeviceRequest(tx, request.id, {
        attempts,
        status: attempts >= PAIRING_CODE_MAX_ATTEMPTS ? "denied" : request.status,
      });

      appendAudit(tx, {
        action: "pairing.redeem_failed",
        decision: "deny",
        resourceType: "device_request",
        resourceId: request.id,
        details: { attemptsLeft },
        now,
      });

      return { kind: "invalid", attemptsLeft };
    }

    if (request.decision === "trust") {
      if (!options.webAuthn.enabled) {
        throw new PairingError("WEBAUTHN_NOT_CONFIGURED", "WebAuthn is not configured");
      }

      if (request.clientOrigin !== options.webAuthn.origin) {
        throw new PairingError("ORIGIN_INVALID", "pairing origin cannot use trusted enrollment");
      }

      if (input.origin !== undefined && input.origin !== options.webAuthn.origin) {
        throw new PairingError(
          "ORIGIN_INVALID",
          "redeem origin does not match the canonical origin",
        );
      }

      const enrollmentToken = generateOpaqueToken();
      const enrollmentExpiresAt = now + ENROLLMENT_TTL_MS;

      updateDeviceRequest(tx, request.id, {
        status: "enrollment_pending",
        codeHash: null,
        enrollmentTokenHash: hashToken(enrollmentToken),
        enrollmentExpiresAt,
      });

      appendAudit(tx, {
        action: "pairing.redeemed",
        decision: "allow",
        resourceType: "device_request",
        resourceId: request.id,
        details: { kind: "trust", enrollmentExpiresAt },
        now,
      });

      return { kind: "enrollment", token: enrollmentToken, expiresAt: enrollmentExpiresAt };
    }

    if (request.decision !== "allow_once") {
      throw new PairingError("CONFLICT", "pairing request has no valid decision");
    }

    const issued = issueSession(tx, {
      kind: "once",
      now,
      ttlMinutes: options.config.auth.sessionTtlMinutes,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    updateDeviceRequest(tx, request.id, {
      status: "redeemed",
      codeHash: null,
      redeemedAt: now,
    });

    appendAudit(tx, {
      action: "pairing.redeemed",
      decision: "allow",
      resourceType: "device_request",
      resourceId: request.id,
      details: { kind: "once", clientSessionId: issued.session.id },
      now,
    });

    return {
      kind: "session",
      sessionId: issued.session.id,
      token: issued.token,
      csrfToken: csrfTokenFor(issued.session.id, options.csrfKey),
      expiresAt: issued.session.expiresAt,
    };
  });

  switch (outcome.kind) {
    case "invalid":
      throw new PairingError("CODE_INVALID", "pairing code is incorrect", {
        attemptsLeft: outcome.attemptsLeft,
      });
    case "expired":
      throw new PairingError("PAIRING_EXPIRED", "pairing code expired");
    case "rate_limited":
      throw new PairingError("RATE_LIMITED", "too many pairing code attempts");
    case "enrollment":
      return {
        kind: "enrollment",
        requestId: input.requestId,
        token: outcome.token,
        expiresAt: outcome.expiresAt,
      };
    case "session":
      return {
        kind: "session",
        requestId: input.requestId,
        clientSessionId: outcome.sessionId,
        token: outcome.token,
        csrfToken: outcome.csrfToken,
        expiresAt: outcome.expiresAt,
      };
  }
}

export function listPairingRequests(
  options: PairingServiceOptions,
  input: { status?: DeviceRequestStatus; now?: number } = {},
): DeviceRequestRow[] {
  const now = input.now ?? Date.now();
  const rows = listDeviceRequests(options.db, input.status);

  if (input.status === "pending") {
    return rows.filter((row) => row.expiresAt > now);
  }

  return rows;
}
