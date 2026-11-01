import { desc } from "drizzle-orm";
import { sanitizeAuditDetails } from "../../security/sanitize.js";
import type { DbExecutor } from "../client.js";
import { newId } from "../ids.js";
import { type AuditDecision, type AuditLogRow, auditLogs } from "../schema.js";

export interface AppendAuditInput {
  action: string;
  decision?: AuditDecision;
  clientSessionId?: string;
  sessionId?: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  now?: number;
}

export function appendAudit(db: DbExecutor, input: AppendAuditInput): AuditLogRow {
  if (input.action.trim().length === 0) {
    throw new Error("audit action must not be empty");
  }

  const row: AuditLogRow = {
    id: newId("aud"),
    clientSessionId: input.clientSessionId ?? null,
    sessionId: input.sessionId ?? null,
    action: input.action,
    resourceType: input.resourceType ?? null,
    resourceId: input.resourceId ?? null,
    decision: input.decision ?? null,
    detailsJson: JSON.stringify(sanitizeAuditDetails(input.details ?? {})),
    createdAt: input.now ?? Date.now(),
  };

  db.insert(auditLogs).values(row).run();
  return row;
}

export function listRecentAudit(db: DbExecutor, limit = 200): AuditLogRow[] {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);

  return db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(safeLimit)
    .all();
}
