import type { WebAuthnRuntime } from "@larness/shared";

export type WebAuthnErrorCode =
  | "NOT_INITIALIZED"
  | "WEBAUTHN_NOT_CONFIGURED"
  | "ORIGIN_INVALID"
  | "ENROLLMENT_EXPIRED"
  | "CHALLENGE_EXPIRED"
  | "PASSKEY_REGISTRATION_FAILED"
  | "PASSKEY_AUTH_FAILED";

export class WebAuthnError extends Error {
  readonly code: WebAuthnErrorCode;

  constructor(code: WebAuthnErrorCode, message: string) {
    super(message);
    this.name = "WebAuthnError";
    this.code = code;
  }
}

export function assertWebAuthnConfigured(webAuthn: WebAuthnRuntime): void {
  if (!webAuthn.enabled) {
    throw new WebAuthnError(
      "WEBAUTHN_NOT_CONFIGURED",
      "WebAuthn is not configured for the current canonical origin",
    );
  }
}

export function assertCanonicalOrigin(webAuthn: WebAuthnRuntime, origin: string | null): void {
  if (origin === null || origin !== webAuthn.origin) {
    throw new WebAuthnError("ORIGIN_INVALID", "Origin does not match the canonical origin");
  }
}
