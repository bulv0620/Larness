import { FileManagerError } from "@larness/resources";
import type { DbExecutor } from "../../db/client.js";
import { type AppendAuditInput, appendAudit } from "../../db/repositories/audit.js";

export type AuditLevel = "required" | "resource" | "debug";

export interface AuditSinkOptions {
  db: DbExecutor;
  now?: () => number;
  debug?: (input: AppendAuditInput) => void;
}

/**
 * Audit levels are expressed by the call contract, not by a database column.
 * required/resource failures propagate to the caller and must close the
 * operation; debug entries never touch the audit table.
 */
export class AuditSink {
  readonly #options: AuditSinkOptions;

  constructor(options: AuditSinkOptions) {
    this.#options = options;
  }

  required(input: Omit<AppendAuditInput, "now">): void {
    try {
      appendAudit(this.#options.db, {
        ...input,
        now: this.#options.now?.() ?? Date.now(),
      });
    } catch {
      throw new FileManagerError("RESOURCE_UNAVAILABLE", "Audit unavailable");
    }
  }

  resource(input: Omit<AppendAuditInput, "now">): void {
    appendAudit(this.#options.db, {
      ...input,
      now: this.#options.now?.() ?? Date.now(),
    });
  }

  debug(input: Omit<AppendAuditInput, "now">): void {
    this.#options.debug?.({
      ...input,
      now: this.#options.now?.() ?? Date.now(),
    });
  }
}
