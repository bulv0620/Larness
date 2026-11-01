import type { ErrorCode } from "@larness/shared";

export class SessionError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "SessionError";
    this.code = code;
    this.details = details;
  }
}
