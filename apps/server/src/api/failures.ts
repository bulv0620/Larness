import { FileManagerError, GitError } from "@larness/resources";
import { HttpError } from "../errors.js";
import { ProjectLockError } from "../modules/agent/projectWriteLock.js";

/**
 * Resource failures carry their own stable codes (`GIT_CONFLICT`,
 * `RESOURCE_LOCKED`, `GIT_UNAVAILABLE`, ...). Without this mapping they reach
 * the client as an opaque `INTERNAL`, which the UI can only render as generic
 * "check the state and retry" advice, so the actual cause stays hidden.
 */
export function mapResourceFailure(error: unknown, fallback = "Resource action failed"): HttpError {
  if (error instanceof GitError) return new HttpError(error.code, error.message);
  if (error instanceof HttpError) return error;
  if (error instanceof FileManagerError) return new HttpError(error.code, error.message);
  if (error instanceof ProjectLockError)
    return new HttpError(error.code, "Project Git write lock was lost");
  return new HttpError("INTERNAL", fallback);
}
