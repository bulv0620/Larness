import type { ErrorCode } from "@larness/shared";

export class DeploymentError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DeploymentError";
  }
}
