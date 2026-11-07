import type { ErrorCode } from "@larness/shared";

export class JobError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "JobError";
    this.code = code;
    this.details = details;
  }
}
