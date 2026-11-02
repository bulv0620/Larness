export const ERROR_CODES = {
  validation: "VALIDATION_ERROR",
  unauthenticated: "UNAUTHENTICATED",
  forbidden: "FORBIDDEN",
  originInvalid: "ORIGIN_INVALID",
  httpsRequired: "HTTPS_REQUIRED",
  csrfInvalid: "CSRF_INVALID",
  notFound: "NOT_FOUND",
  notInitialized: "NOT_INITIALIZED",
  conflict: "CONFLICT",
  turnInProgress: "TURN_IN_PROGRESS",
  resourceLocked: "RESOURCE_LOCKED",
  versionConflict: "VERSION_CONFLICT",
  pairingDenied: "PAIRING_DENIED",
  pairingExpired: "PAIRING_EXPIRED",
  codeInvalid: "CODE_INVALID",
  enrollmentExpired: "ENROLLMENT_EXPIRED",
  challengeExpired: "CHALLENGE_EXPIRED",
  passkeyRegistrationFailed: "PASSKEY_REGISTRATION_FAILED",
  passkeyAuthFailed: "PASSKEY_AUTH_FAILED",
  webauthnNotConfigured: "WEBAUTHN_NOT_CONFIGURED",
  rateLimited: "RATE_LIMITED",
  pathOutsideProject: "PATH_OUTSIDE_PROJECT",
  approvalInvalid: "APPROVAL_INVALID",
  previewTargetInvalid: "PREVIEW_TARGET_INVALID",
  providerUnavailable: "PROVIDER_UNAVAILABLE",
  providerAuthFailed: "PROVIDER_AUTH_FAILED",
  providerRateLimited: "PROVIDER_RATE_LIMITED",
  providerContextLimit: "PROVIDER_CONTEXT_LIMIT",
  providerContentFiltered: "PROVIDER_CONTENT_FILTERED",
  providerUnknown: "PROVIDER_UNKNOWN",
  devWebUnavailable: "DEV_WEB_UNAVAILABLE",
  internal: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  ORIGIN_INVALID: 403,
  HTTPS_REQUIRED: 403,
  CSRF_INVALID: 403,
  NOT_FOUND: 404,
  NOT_INITIALIZED: 409,
  CONFLICT: 409,
  TURN_IN_PROGRESS: 409,
  RESOURCE_LOCKED: 409,
  VERSION_CONFLICT: 409,
  PAIRING_DENIED: 403,
  PAIRING_EXPIRED: 410,
  CODE_INVALID: 400,
  ENROLLMENT_EXPIRED: 410,
  CHALLENGE_EXPIRED: 410,
  PASSKEY_REGISTRATION_FAILED: 400,
  PASSKEY_AUTH_FAILED: 401,
  WEBAUTHN_NOT_CONFIGURED: 409,
  RATE_LIMITED: 429,
  PATH_OUTSIDE_PROJECT: 403,
  APPROVAL_INVALID: 409,
  PREVIEW_TARGET_INVALID: 403,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_AUTH_FAILED: 502,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_CONTEXT_LIMIT: 413,
  PROVIDER_CONTENT_FILTERED: 422,
  PROVIDER_UNKNOWN: 502,
  DEV_WEB_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
  requestId: string;
}

export interface ErrorResponse {
  error: ApiError;
}
