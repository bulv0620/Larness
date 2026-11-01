import { createHash } from "node:crypto";
import type { AppConfig, WebAuthnRuntime } from "@larness/shared";
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { csrfTokenFor } from "../auth/csrf.js";
import { isInitialized } from "../auth/initialized.js";
import { issueSession } from "../auth/sessions.js";
import { generateOpaqueToken, hashToken } from "../auth/tokens.js";
import type { Database, DbExecutor } from "../db/client.js";
import { appendAudit } from "../db/repositories/audit.js";
import { revokeDeviceSessions } from "../db/repositories/browser-sessions.js";
import {
  getDeviceRequestByEnrollmentTokenHash,
  getDeviceRequestById,
  updateDeviceRequest,
} from "../db/repositories/device-requests.js";
import { getMeta } from "../db/repositories/meta.js";
import {
  createTrustedDevice,
  getTrustedDevice,
  listTrustedDevices,
  revokeTrustedDevice,
  updateTrustedDeviceLastSeen,
} from "../db/repositories/trusted-devices.js";
import {
  consumeChallenge,
  createChallenge,
  getChallenge,
} from "../db/repositories/webauthn-challenges.js";
import {
  createWebAuthnCredential,
  getActiveCredentialByDevice,
  getCredentialByCredentialId,
  listActiveCredentials,
  listCredentialsByDevice,
  revokeCredentialsByDevice,
  updateCredentialUsage,
} from "../db/repositories/webauthn-credentials.js";
import type { DeviceRequestRow, TrustedDeviceRow, WebAuthnCredentialRow } from "../db/schema.js";
import { immediateTransaction } from "../db/transaction.js";
import { assertCanonicalOrigin, assertWebAuthnConfigured, WebAuthnError } from "./rp.js";

export const CHALLENGE_TTL_MS = 5 * 60_000;

export interface WebAuthnServiceOptions {
  db: Database;
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
  csrfKey: Buffer;
  now?: () => number;
}

export interface WebAuthnSession {
  sessionId: string;
  deviceId: string;
  credentialId: string;
  kind: "passkey";
  token: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
  backupEligible: boolean;
  backupState: boolean;
}

export interface RegistrationOptionsResult {
  challengeId: string;
  options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
}

export interface AuthenticationOptionsResult {
  challengeId: string;
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
}

export class DeviceAdminError extends Error {
  readonly code: "NOT_FOUND" | "CONFLICT";

  constructor(code: "NOT_FOUND" | "CONFLICT", message: string) {
    super(message);
    this.name = "DeviceAdminError";
    this.code = code;
  }
}

export interface DeviceWithCredentials {
  device: TrustedDeviceRow;
  credentials: WebAuthnCredentialRow[];
}

function requireInitialized(options: WebAuthnServiceOptions): void {
  if (!isInitialized(options.db)) {
    throw new WebAuthnError("NOT_INITIALIZED", "workspace is not initialized");
  }
}

function nowOf(options: WebAuthnServiceOptions): number {
  return (options.now ?? Date.now)();
}

function requireEnrollment(
  options: WebAuthnServiceOptions,
  enrollmentToken: string,
  now: number,
): DeviceRequestRow {
  if (enrollmentToken.length === 0) {
    throw new WebAuthnError("ENROLLMENT_EXPIRED", "Passkey enrollment has expired");
  }

  const enrollment = getDeviceRequestByEnrollmentTokenHash(options.db, hashToken(enrollmentToken));

  if (
    enrollment === null ||
    enrollment.status !== "enrollment_pending" ||
    enrollment.enrollmentExpiresAt === null ||
    enrollment.enrollmentExpiresAt <= now
  ) {
    throw new WebAuthnError("ENROLLMENT_EXPIRED", "Passkey enrollment has expired");
  }

  return enrollment;
}

function readReportedCounter(response: AuthenticationResponseJSON): number | null {
  const encoded = response.response.authenticatorData;

  if (typeof encoded !== "string") {
    return null;
  }

  try {
    const bytes = isoBase64URL.toBuffer(encoded);

    if (bytes.length < 37) {
      return null;
    }

    return (
      (((bytes[33] ?? 0) << 24) |
        ((bytes[34] ?? 0) << 16) |
        ((bytes[35] ?? 0) << 8) |
        (bytes[36] ?? 0)) >>>
      0
    );
  } catch {
    return null;
  }
}

function parseTransports(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function auditFailure(
  options: WebAuthnServiceOptions,
  action: string,
  now: number,
  details: Record<string, unknown> = {},
): void {
  try {
    appendAudit(options.db, {
      action,
      decision: "deny",
      resourceType: "passkey",
      details,
      now,
    });
  } catch {
    // Preserve the original failure; success paths audit inside their transaction.
  }
}

export async function registrationOptions(
  options: WebAuthnServiceOptions,
  input: { origin: string | null; enrollmentToken: string },
): Promise<RegistrationOptionsResult> {
  requireInitialized(options);
  assertWebAuthnConfigured(options.webAuthn);
  assertCanonicalOrigin(options.webAuthn, input.origin);

  const now = nowOf(options);
  const enrollment = requireEnrollment(options, input.enrollmentToken, now);
  const instanceId = getMeta(options.db, "instance_id") ?? "larness-instance";

  const challenge = generateOpaqueToken();
  const optionsJSON = await generateRegistrationOptions({
    rpName: options.webAuthn.rpName,
    rpID: options.webAuthn.rpId,
    userID: Uint8Array.from(createHash("sha256").update(instanceId).digest()),
    userName: "operator",
    userDisplayName: "Larness Operator",
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: listActiveCredentials(options.db).map((credential) => ({
      id: credential.credentialId,
      transports: parseTransports(credential.transportsJson),
    })),
    timeout: 60_000,
    challenge,
  });

  const row = createChallenge(options.db, {
    type: "registration",
    challenge: optionsJSON.challenge,
    requestId: enrollment.id,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
  });

  return { challengeId: row.id, options: optionsJSON };
}

export async function verifyRegistration(
  options: WebAuthnServiceOptions,
  input: {
    origin: string | null;
    enrollmentToken: string;
    challengeId: string;
    response: RegistrationResponseJSON;
  },
): Promise<WebAuthnSession> {
  requireInitialized(options);
  assertWebAuthnConfigured(options.webAuthn);
  assertCanonicalOrigin(options.webAuthn, input.origin);

  const now = nowOf(options);
  const enrollment = requireEnrollment(options, input.enrollmentToken, now);
  const challenge = getChallenge(options.db, input.challengeId);

  if (challenge === null || challenge.type !== "registration" || challenge.expiresAt <= now) {
    throw new WebAuthnError("CHALLENGE_EXPIRED", "registration challenge expired");
  }

  if (!consumeChallenge(options.db, challenge.id, now)) {
    throw new WebAuthnError("CHALLENGE_EXPIRED", "registration challenge was already used");
  }

  if (challenge.requestId !== enrollment.id) {
    throw new WebAuthnError("PASSKEY_REGISTRATION_FAILED", "registration failed");
  }

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;

  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: options.webAuthn.origin,
      expectedRPID: options.webAuthn.rpId,
      requireUserVerification: true,
    });
  } catch {
    auditFailure(options, "auth.passkey.registration_failed", now);
    throw new WebAuthnError("PASSKEY_REGISTRATION_FAILED", "registration failed");
  }

  if (!verification.verified) {
    auditFailure(options, "auth.passkey.registration_failed", now);
    throw new WebAuthnError("PASSKEY_REGISTRATION_FAILED", "registration failed");
  }

  const info = verification.registrationInfo;

  try {
    const created = immediateTransaction(options.db, (tx) => {
      const current = getDeviceRequestById(tx, enrollment.id);

      if (
        current === null ||
        current.status !== "enrollment_pending" ||
        current.enrollmentTokenHash !== hashToken(input.enrollmentToken)
      ) {
        throw new WebAuthnError("PASSKEY_REGISTRATION_FAILED", "registration failed");
      }

      const device = createTrustedDevice(tx, {
        label: enrollment.clientLabel ?? "Passkey device",
        createdByRequestId: enrollment.id,
        userAgent: enrollment.userAgent ?? undefined,
        createdAt: now,
      });

      const credential = createWebAuthnCredential(tx, {
        deviceId: device.id,
        credentialId: info.credential.id,
        publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
        counter: info.credential.counter,
        transportsJson: JSON.stringify(info.credential.transports ?? []),
        aaguid: info.aaguid,
        backupEligible: info.credentialDeviceType === "multiDevice",
        backupState: info.credentialBackedUp,
        createdAt: now,
      });

      updateDeviceRequest(tx, enrollment.id, {
        status: "redeemed",
        redeemedAt: now,
        enrollmentTokenHash: null,
      });

      const issued = issueSession(tx, {
        kind: "passkey",
        now,
        ttlMinutes: options.config.auth.sessionTtlMinutes,
        deviceId: device.id,
        userAgent: enrollment.userAgent ?? undefined,
      });

      appendAudit(tx, {
        action: "auth.passkey.registered",
        decision: "allow",
        resourceType: "device",
        resourceId: device.id,
        details: {
          aaguid: info.aaguid,
          credentialDeviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
          requestId: enrollment.id,
        },
        now,
      });

      return { device, credential, issued };
    });

    return {
      sessionId: created.issued.session.id,
      deviceId: created.device.id,
      credentialId: created.credential.credentialId,
      kind: "passkey",
      token: created.issued.token,
      csrfToken: csrfTokenFor(created.issued.session.id, options.csrfKey),
      createdAt: created.issued.session.createdAt,
      expiresAt: created.issued.session.expiresAt,
      backupEligible: created.credential.backupEligible,
      backupState: created.credential.backupState,
    };
  } catch (error) {
    auditFailure(options, "auth.passkey.registration_failed", now);

    if (error instanceof WebAuthnError) {
      throw error;
    }

    throw new WebAuthnError("PASSKEY_REGISTRATION_FAILED", "registration failed");
  }
}

export async function authenticationOptions(
  options: WebAuthnServiceOptions,
  input: { origin: string | null },
): Promise<AuthenticationOptionsResult> {
  requireInitialized(options);
  assertWebAuthnConfigured(options.webAuthn);
  assertCanonicalOrigin(options.webAuthn, input.origin);

  const now = nowOf(options);
  const challenge = generateOpaqueToken();
  const optionsJSON = await generateAuthenticationOptions({
    rpID: options.webAuthn.rpId,
    allowCredentials: [],
    userVerification: "required",
    timeout: 60_000,
    challenge,
  });

  const row = createChallenge(options.db, {
    type: "authentication",
    challenge: optionsJSON.challenge,
    createdAt: now,
    expiresAt: now + CHALLENGE_TTL_MS,
  });

  return { challengeId: row.id, options: optionsJSON };
}

export async function verifyAuthentication(
  options: WebAuthnServiceOptions,
  input: { origin: string | null; challengeId: string; response: AuthenticationResponseJSON },
): Promise<WebAuthnSession> {
  requireInitialized(options);
  assertWebAuthnConfigured(options.webAuthn);
  assertCanonicalOrigin(options.webAuthn, input.origin);

  const now = nowOf(options);
  const challenge = getChallenge(options.db, input.challengeId);

  if (challenge === null || challenge.type !== "authentication" || challenge.expiresAt <= now) {
    throw new WebAuthnError("CHALLENGE_EXPIRED", "authentication challenge expired");
  }

  if (!consumeChallenge(options.db, challenge.id, now)) {
    throw new WebAuthnError("CHALLENGE_EXPIRED", "authentication challenge was already used");
  }

  const credential =
    typeof input.response.id === "string"
      ? getCredentialByCredentialId(options.db, input.response.id)
      : null;
  const device = credential === null ? null : getTrustedDevice(options.db, credential.deviceId);

  if (
    credential === null ||
    credential.revokedAt !== null ||
    device === null ||
    device.revokedAt !== null
  ) {
    auditFailure(options, "auth.passkey.login_failed", now);
    throw new WebAuthnError("PASSKEY_AUTH_FAILED", "passkey authentication failed");
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
  const reportedCounter = readReportedCounter(input.response);
  // Synced passkeys may legitimately not increase the counter. The spec allows a
  // rollback as long as it is audited, so relax only the library's monotonic check
  // while still verifying the signature and everything else.
  const counterForVerification =
    reportedCounter !== null && reportedCounter <= credential.counter && credential.counter > 0
      ? reportedCounter === 0
        ? -1
        : reportedCounter - 1
      : credential.counter;

  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge.challenge,
      expectedOrigin: options.webAuthn.origin,
      expectedRPID: options.webAuthn.rpId,
      credential: {
        id: credential.credentialId,
        publicKey: isoBase64URL.toBuffer(credential.publicKey),
        counter: counterForVerification,
        transports: parseTransports(credential.transportsJson),
      },
      requireUserVerification: true,
    });
  } catch {
    auditFailure(options, "auth.passkey.login_failed", now);
    throw new WebAuthnError("PASSKEY_AUTH_FAILED", "passkey authentication failed");
  }

  if (!verification.verified) {
    auditFailure(options, "auth.passkey.login_failed", now);
    throw new WebAuthnError("PASSKEY_AUTH_FAILED", "passkey authentication failed");
  }

  if (verification.authenticationInfo.newCounter < credential.counter && credential.counter > 0) {
    try {
      appendAudit(options.db, {
        action: "auth.passkey.counter_anomaly",
        decision: "info",
        resourceType: "device",
        resourceId: device.id,
        details: {
          storedCounter: credential.counter,
          receivedCounter: verification.authenticationInfo.newCounter,
        },
        now,
      });
    } catch {
      // Counter rollback is informational; verification already passed.
    }
  }

  const backupEligible =
    credential.backupEligible ||
    verification.authenticationInfo.credentialDeviceType === "multiDevice";
  const backupState = verification.authenticationInfo.credentialBackedUp;

  const created = immediateTransaction(options.db, (tx) => {
    updateCredentialUsage(tx, credential.id, {
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: now,
      backupEligible,
      backupState,
    });
    updateTrustedDeviceLastSeen(tx, device.id, now);

    const issued = issueSession(tx, {
      kind: "passkey",
      now,
      ttlMinutes: options.config.auth.sessionTtlMinutes,
      deviceId: device.id,
    });

    appendAudit(tx, {
      action: "auth.passkey.login",
      decision: "allow",
      resourceType: "device",
      resourceId: device.id,
      details: { credentialDeviceType: verification.authenticationInfo.credentialDeviceType },
      now,
    });

    return issued;
  });

  return {
    sessionId: created.session.id,
    deviceId: device.id,
    credentialId: credential.credentialId,
    kind: "passkey",
    token: created.token,
    csrfToken: csrfTokenFor(created.session.id, options.csrfKey),
    createdAt: created.session.createdAt,
    expiresAt: created.session.expiresAt,
    backupEligible,
    backupState,
  };
}

export function listDevices(options: WebAuthnServiceOptions): DeviceWithCredentials[] {
  return listTrustedDevices(options.db, true).map((device) => ({
    device,
    credentials: listCredentialsByDevice(options.db, device.id),
  }));
}

export function getActiveCredential(
  options: WebAuthnServiceOptions,
  deviceId: string,
): WebAuthnCredentialRow | null {
  return getActiveCredentialByDevice(options.db, deviceId);
}

export function revokeDevice(
  options: WebAuthnServiceOptions,
  input: { deviceId: string },
): { revokedCredentials: number; revokedSessions: number } {
  const now = nowOf(options);

  return immediateTransaction(options.db, (tx: DbExecutor) => {
    const device = getTrustedDevice(tx, input.deviceId);

    if (device === null) {
      throw new DeviceAdminError("NOT_FOUND", "device not found");
    }

    const revokedCredentials = revokeCredentialsByDevice(tx, device.id, now);
    const revokedSessions = revokeDeviceSessions(tx, device.id, now);
    revokeTrustedDevice(tx, device.id, now);

    appendAudit(tx, {
      action: "device.revoked",
      decision: "allow",
      resourceType: "device",
      resourceId: device.id,
      details: { revokedCredentials, revokedSessions },
      now,
    });

    return { revokedCredentials, revokedSessions };
  });
}
