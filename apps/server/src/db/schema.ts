import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export type DeviceRequestStatus =
  | "pending"
  | "approved"
  | "denied"
  | "expired"
  | "enrollment_pending"
  | "redeemed";

export type PairingDecision = "allow_once" | "trust";
export type SessionKind = "once" | "passkey";
export type ChallengeType = "registration" | "authentication";
export type AuditDecision = "allow" | "deny" | "info";
export type SessionStatus = "active" | "archived";
export type TurnStatus =
  | "QUEUED"
  | "PREPARING"
  | "RUNNING"
  | "WAITING_APPROVAL"
  | "CANCELLING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "INTERRUPTED";
export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";
export type ResourceLockType = "project" | "service" | "file" | "git" | "global-maintenance";

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    rootPath: text("root_path").notNull(),
    realPath: text("real_path").notNull().unique(),
    settingsJson: text("settings_json").notNull().default("{}"),
    gitDetected: integer("git_detected", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_projects_updated").on(table.updatedAt)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    workspacePath: text("workspace_path").notNull(),
    title: text("title").notNull(),
    status: text("status").$type<SessionStatus>().notNull().default("active"),
    modelProfileId: text("model_profile_id"),
    approvalPolicyId: text("approval_policy_id").notNull().default("standard"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastActivityAt: integer("last_activity_at").notNull(),
  },
  (table) => [
    index("idx_sessions_project_updated").on(table.projectId, table.updatedAt),
    index("idx_sessions_updated").on(table.updatedAt),
  ],
);

export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    modelProfileId: text("model_profile_id"),
    provider: text("provider"),
    model: text("model"),
    status: text("status").$type<TurnStatus>().notNull(),
    inputJson: text("input_json").notNull(),
    usageJson: text("usage_json"),
    errorJson: text("error_json"),
    idempotencyKey: text("idempotency_key"),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
  },
  (table) => [
    uniqueIndex("turns_session_idempotency_unique").on(table.sessionId, table.idempotencyKey),
    index("idx_turns_session_created").on(table.sessionId, table.createdAt),
    index("idx_turns_session_status").on(table.sessionId, table.status),
  ],
);

export const agentEvents = sqliteTable(
  "agent_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    turnId: text("turn_id").references(() => turns.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("agent_events_session_seq_unique").on(table.sessionId, table.seq)],
);

export const approvals = sqliteTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    risk: text("risk").notNull(),
    status: text("status").$type<ApprovalStatus>().notNull().default("pending"),
    scopeJson: text("scope_json").notNull().default("{}"),
    paramsHash: text("params_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    decidedAt: integer("decided_at"),
    decidedBy: text("decided_by"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_approvals_turn_status").on(table.turnId, table.status),
    index("idx_approvals_expiry").on(table.expiresAt),
  ],
);

export const resourceLocks = sqliteTable(
  "resource_locks",
  {
    id: text("id").primaryKey(),
    resourceType: text("resource_type").$type<ResourceLockType>().notNull(),
    resourceId: text("resource_id").notNull(),
    owner: text("owner").notNull(),
    executionId: text("execution_id").notNull(),
    fencingToken: integer("fencing_token").notNull(),
    expiresAt: integer("expires_at").notNull(),
    heartbeatAt: integer("heartbeat_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("resource_locks_resource_unique").on(table.resourceType, table.resourceId),
    index("idx_resource_locks_expiry").on(table.expiresAt),
  ],
);

export const authSettings = sqliteTable(
  "auth_settings",
  {
    id: integer("id").primaryKey(),
    adminHash: text("admin_hash").notNull(),
    adminUpdatedAt: integer("admin_updated_at").notNull(),
    initializedAt: integer("initialized_at").notNull(),
  },
  (table) => [check("auth_settings_single_row", sql`${table.id} = 1`)],
);

export const deviceRequests = sqliteTable(
  "device_requests",
  {
    id: text("id").primaryKey(),
    shortCode: text("short_code").notNull().unique(),
    status: text("status").$type<DeviceRequestStatus>().notNull(),
    decision: text("decision").$type<PairingDecision>(),
    clientLabel: text("client_label"),
    userAgent: text("user_agent"),
    ip: text("ip"),
    clientOrigin: text("client_origin"),
    pollTokenHash: text("poll_token_hash").notNull(),
    codeHash: text("code_hash"),
    codeExpiresAt: integer("code_expires_at"),
    attempts: integer("attempts").notNull().default(0),
    enrollmentTokenHash: text("enrollment_token_hash"),
    enrollmentExpiresAt: integer("enrollment_expires_at"),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    decidedAt: integer("decided_at"),
    redeemedAt: integer("redeemed_at"),
  },
  (table) => [index("idx_device_requests_status").on(table.status, table.expiresAt)],
);

export const trustedDevices = sqliteTable("trusted_devices", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  createdByRequestId: text("created_by_request_id").references(() => deviceRequests.id),
  userAgent: text("user_agent"),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at"),
  revokedAt: integer("revoked_at"),
});

export const webauthnCredentials = sqliteTable(
  "webauthn_credentials",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => trustedDevices.id),
    credentialId: text("credential_id").notNull().unique(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transportsJson: text("transports_json").notNull().default("[]"),
    aaguid: text("aaguid"),
    backupEligible: integer("backup_eligible", { mode: "boolean" }).notNull().default(false),
    backupState: integer("backup_state", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
    revokedAt: integer("revoked_at"),
  },
  (table) => [index("idx_webauthn_credentials_device").on(table.deviceId)],
);

export const webauthnChallenges = sqliteTable(
  "webauthn_challenges",
  {
    id: text("id").primaryKey(),
    type: text("type").$type<ChallengeType>().notNull(),
    challenge: text("challenge").notNull(),
    requestId: text("request_id").references(() => deviceRequests.id),
    deviceId: text("device_id").references(() => trustedDevices.id),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
  },
  (table) => [index("idx_webauthn_challenges_expiry").on(table.expiresAt)],
);

export const browserSessions = sqliteTable(
  "browser_sessions",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").references(() => trustedDevices.id),
    tokenHash: text("token_hash").notNull().unique(),
    kind: text("kind").$type<SessionKind>().notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: integer("created_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (table) => [index("idx_browser_sessions_device").on(table.deviceId)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    clientSessionId: text("client_session_id"),
    sessionId: text("session_id"),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    decision: text("decision").$type<AuditDecision>(),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_audit_created").on(table.createdAt),
    index("idx_audit_action").on(table.action, table.createdAt),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type TurnRow = typeof turns.$inferSelect;
export type AgentEventRow = typeof agentEvents.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type ResourceLockRow = typeof resourceLocks.$inferSelect;
export type AppMetaRow = typeof appMeta.$inferSelect;
export type AuthSettingsRow = typeof authSettings.$inferSelect;
export type DeviceRequestRow = typeof deviceRequests.$inferSelect;
export type TrustedDeviceRow = typeof trustedDevices.$inferSelect;
export type WebAuthnCredentialRow = typeof webauthnCredentials.$inferSelect;
export type WebAuthnChallengeRow = typeof webauthnChallenges.$inferSelect;
export type BrowserSessionRow = typeof browserSessions.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
