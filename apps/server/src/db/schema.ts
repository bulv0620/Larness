import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

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

export type AppMetaRow = typeof appMeta.$inferSelect;
export type AuthSettingsRow = typeof authSettings.$inferSelect;
export type DeviceRequestRow = typeof deviceRequests.$inferSelect;
export type TrustedDeviceRow = typeof trustedDevices.$inferSelect;
export type WebAuthnCredentialRow = typeof webauthnCredentials.$inferSelect;
export type WebAuthnChallengeRow = typeof webauthnChallenges.$inferSelect;
export type BrowserSessionRow = typeof browserSessions.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
