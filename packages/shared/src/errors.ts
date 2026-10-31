export const ERROR_CODES = {
  unauthenticated: "UNAUTHENTICATED",
  forbidden: "FORBIDDEN",
  notFound: "NOT_FOUND",
  validation: "VALIDATION_ERROR",
  conflict: "CONFLICT",
  rateLimited: "RATE_LIMITED",
  internal: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
