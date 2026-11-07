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
export type ModelProviderId = "deepseek" | "glm" | "openai-compatible";

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
    credentialProfileId: text("credential_profile_id"),
    model: text("model"),
    thinking: text("thinking"),
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
    credentialProfileId: text("credential_profile_id"),
    provider: text("provider"),
    model: text("model"),
    thinking: text("thinking"),
    contextWindow: integer("context_window"),
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
    rootRealPath: text("root_real_path"),
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

export const secrets = sqliteTable("secrets", {
  id: text("id").primaryKey(),
  ciphertext: text("ciphertext").notNull(),
  nonce: text("nonce").notNull(),
  tag: text("tag").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const credentialProfiles = sqliteTable(
  "credential_profiles",
  {
    id: text("id").primaryKey(),
    provider: text("provider").$type<ModelProviderId>().notNull(),
    label: text("label").notNull(),
    secretRef: text("secret_ref")
      .notNull()
      .references(() => secrets.id, { onDelete: "cascade" }),
    endpoint: text("endpoint"),
    contextWindow: integer("context_window"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_credential_profiles_provider").on(table.provider)],
);

export const modelProfiles = sqliteTable(
  "model_profiles",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    provider: text("provider").$type<ModelProviderId>().notNull(),
    model: text("model").notNull(),
    credentialProfileId: text("credential_profile_id").references(() => credentialProfiles.id, {
      onDelete: "set null",
    }),
    endpoint: text("endpoint"),
    capabilitiesJson: text("capabilities_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_model_profiles_provider").on(table.provider)],
);

export const modelCatalogCache = sqliteTable("model_catalog_cache", {
  credentialProfileId: text("credential_profile_id")
    .primaryKey()
    .references(() => credentialProfiles.id, { onDelete: "cascade" }),
  provider: text("provider").$type<ModelProviderId>().notNull(),
  endpoint: text("endpoint").notNull(),
  modelsJson: text("models_json").notNull().default("[]"),
  syncedAt: integer("synced_at"),
  lastAttemptAt: integer("last_attempt_at"),
  lastErrorCode: text("last_error_code"),
});

export const modelVisibility = sqliteTable(
  "model_visibility",
  {
    id: text("id").primaryKey(),
    credentialProfileId: text("credential_profile_id")
      .notNull()
      .references(() => credentialProfiles.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    visible: integer("visible").notNull().default(1),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("model_visibility_credential_model").on(table.credentialProfileId, table.modelId),
  ],
);

export const modelDefaults = sqliteTable(
  "model_defaults",
  {
    id: text("id").primaryKey(),
    credentialProfileId: text("credential_profile_id")
      .notNull()
      .references(() => credentialProfiles.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    thinking: text("thinking").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [check("model_defaults_single_row", sql`${table.id} = 'default'`)],
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
export type SecretRow = typeof secrets.$inferSelect;
export type CredentialProfileRow = typeof credentialProfiles.$inferSelect;
export type ModelProfileRow = typeof modelProfiles.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type TurnRow = typeof turns.$inferSelect;
export type AgentEventRow = typeof agentEvents.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type ResourceLockRow = typeof resourceLocks.$inferSelect;
export const fileVersions = sqliteTable(
  "file_versions",
  {
    scopeKey: text("scope_key").notNull(),
    path: text("path").notNull(),
    realPath: text("real_path").notNull(),
    versionHash: text("version_hash").notNull(),
    size: integer("size").notNull(),
    mtime: integer("mtime").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("file_versions_scope_path").on(table.scopeKey, table.path)],
);
export const resourceStreams = sqliteTable("resource_streams", {
  streamId: text("stream_id").primaryKey(),
  lastSeq: integer("last_seq").notNull().default(0),
});
export const resourceEvents = sqliteTable(
  "resource_events",
  {
    id: text("id").primaryKey(),
    streamId: text("stream_id")
      .notNull()
      .references(() => resourceStreams.streamId),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("resource_events_stream_seq").on(table.streamId, table.seq)],
);
export type ResourceOperationStatus =
  | "PREPARED"
  | "WRITING"
  | "COMPLETED"
  | "FAILED"
  | "RECONCILIATION_REQUIRED";
export const resourceOperations = sqliteTable(
  "resource_operations",
  {
    id: text("id").primaryKey(),
    scopeKey: text("scope_key").notNull(),
    rootRealPath: text("root_real_path").notNull(),
    kind: text("kind").notNull(),
    status: text("status").$type<ResourceOperationStatus>().notNull(),
    paramsHash: text("params_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    clientSessionId: text("client_session_id").notNull(),
    path: text("path").notNull(),
    expectedVersion: text("expected_version").notNull(),
    targetVersion: text("target_version").notNull(),
    lockId: text("lock_id").notNull(),
    fencingToken: integer("fencing_token").notNull(),
    resultJson: text("result_json"),
    errorCode: text("error_code"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("resource_operations_client_kind_key").on(
      table.clientSessionId,
      table.kind,
      table.idempotencyKey,
    ),
    index("resource_operations_status").on(table.status),
  ],
);
export type ResourceOperationRow = typeof resourceOperations.$inferSelect;
export type AppMetaRow = typeof appMeta.$inferSelect;
export type AuthSettingsRow = typeof authSettings.$inferSelect;
export type DeviceRequestRow = typeof deviceRequests.$inferSelect;
export type TrustedDeviceRow = typeof trustedDevices.$inferSelect;
export type WebAuthnCredentialRow = typeof webauthnCredentials.$inferSelect;
export type WebAuthnChallengeRow = typeof webauthnChallenges.$inferSelect;
export type BrowserSessionRow = typeof browserSessions.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;

export const commandExecutions = sqliteTable(
  "command_executions",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id")
      .notNull()
      .references(() => resourceOperations.id),
    projectId: text("project_id"),
    workspaceSessionId: text("workspace_session_id"),
    sessionId: text("session_id").notNull(),
    turnId: text("turn_id").notNull(),
    toolCallId: text("tool_call_id").notNull(),
    policySnapshotId: text("policy_snapshot_id").notNull(),
    paramsHash: text("params_hash").notNull(),
    status: text("status").$type<import("@larness/shared").CommandStatus>().notNull(),
    exitCode: integer("exit_code"),
    reasonCode: text("reason_code"),
    truncated: integer("truncated", { mode: "boolean" }).notNull().default(false),
    processIdentityJson: text("process_identity_json"),
    outputCursor: integer("output_cursor").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
  },
  (table) => [
    uniqueIndex("command_executions_operation").on(table.operationId),
    index("command_executions_status").on(table.status),
  ],
);
export type CommandExecutionRow = typeof commandExecutions.$inferSelect;

export const terminals = sqliteTable(
  "terminals",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id")
      .notNull()
      .references(() => resourceOperations.id),
    projectId: text("project_id"),
    workspaceSessionId: text("workspace_session_id"),
    sourceSessionId: text("source_session_id"),
    cwd: text("cwd").notNull(),
    shell: text("shell").notNull(),
    mode: text("mode").$type<"shell" | "dev">().notNull(),
    role: text("role"),
    title: text("title"),
    launchParamsJson: text("launch_params_json"),
    launchParamsHash: text("launch_params_hash"),
    createdByTurnId: text("created_by_turn_id"),
    status: text("status").$type<import("@larness/shared").TerminalStatus>().notNull(),
    processIdentityJson: text("process_identity_json"),
    reasonCode: text("reason_code"),
    outputCursor: integer("output_cursor").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
    exitCode: integer("exit_code"),
  },
  (table) => [
    uniqueIndex("terminals_operation").on(table.operationId),
    index("terminals_status").on(table.status),
    uniqueIndex("terminals_active_role")
      .on(table.projectId, table.role)
      .where(sql`${table.mode} = 'dev' AND ${table.status} IN ('CREATED', 'RUNNING', 'STOPPING')`),
  ],
);
export type TerminalRow = typeof terminals.$inferSelect;
export const services = sqliteTable(
  "services",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id")
      .notNull()
      .references(() => resourceOperations.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    sourceSessionId: text("source_session_id"),
    terminalId: text("terminal_id")
      .notNull()
      .references(() => terminals.id),
    name: text("name").notNull(),
    kind: text("kind").$type<import("@larness/shared").ServiceKind>().notNull(),
    status: text("status").$type<import("@larness/shared").ServiceStatus>().notNull(),
    terminalExecutionId: text("terminal_execution_id").notNull(),
    endpointGeneration: integer("endpoint_generation").notNull(),
    endpointHost: text("endpoint_host").notNull(),
    endpointPort: integer("endpoint_port").notNull(),
    endpointProtocol: text("endpoint_protocol").$type<"http">().notNull(),
    identityJson: text("identity_json").notNull(),
    reasonCode: text("reason_code"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    endedAt: integer("ended_at"),
  },
  (table) => [
    uniqueIndex("services_operation").on(table.operationId),
    index("services_project_status").on(table.projectId, table.status),
    index("services_terminal").on(table.terminalId),
    uniqueIndex("services_active_endpoint")
      .on(table.terminalId, table.endpointHost, table.endpointPort)
      .where(sql`${table.status} IN ('REGISTERING', 'STARTING', 'RUNNING')`),
    check(
      "services_status",
      sql`${table.status} IN ('REGISTERING', 'STARTING', 'RUNNING', 'UNKNOWN', 'UNREGISTERED')`,
    ),
    check("services_host", sql`${table.endpointHost} IN ('127.0.0.1', '::1')`),
    check("services_port", sql`${table.endpointPort} BETWEEN 1 AND 65535`),
    check("services_protocol", sql`${table.endpointProtocol} = 'http'`),
  ],
);
export type ServiceRow = typeof services.$inferSelect;
export const resourceActions = sqliteTable(
  "resource_actions",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id")
      .notNull()
      .references(() => resourceOperations.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind").notNull(),
    risk: text("risk").$type<"L1" | "L2">().notNull(),
    status: text("status")
      .$type<
        | "PREPARED"
        | "WAITING_APPROVAL"
        | "APPROVED"
        | "RUNNING"
        | "COMPLETED"
        | "FAILED"
        | "REJECTED"
        | "EXPIRED"
        | "INTERRUPTED"
      >()
      .notNull(),
    paramsJson: text("params_json").notNull(),
    paramsHash: text("params_hash").notNull(),
    snapshotHash: text("snapshot_hash").notNull(),
    requestedBy: text("requested_by").notNull(),
    decidedBy: text("decided_by"),
    expiresAt: integer("expires_at").notNull(),
    decidedAt: integer("decided_at"),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
    resultJson: text("result_json"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("resource_actions_operation").on(table.operationId),
    index("resource_actions_project_status").on(table.projectId, table.status),
  ],
);
export type ResourceActionRow = typeof resourceActions.$inferSelect;

export const terminalLeases = sqliteTable("terminal_leases", {
  terminalId: text("terminal_id")
    .primaryKey()
    .references(() => terminals.id),
  generation: integer("generation").notNull().default(0),
  ownerType: text("owner_type").$type<"human" | "agent">(),
  ownerClientSessionId: text("owner_client_session_id"),
  ownerConnectionId: text("owner_connection_id"),
  ownerSessionId: text("owner_session_id"),
  ownerTurnId: text("owner_turn_id"),
  ownerExecutionId: text("owner_execution_id"),
  expiresAt: integer("expires_at").notNull().default(0),
  heartbeatAt: integer("heartbeat_at").notNull().default(0),
  inputSequence: integer("input_sequence").notNull().default(0),
});
export type TerminalLeaseRow = typeof terminalLeases.$inferSelect;

export const deploymentTargets = sqliteTable(
  "deployment_targets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    currentArtifactId: text("current_artifact_id"),
    currentVersion: text("current_version"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("deployment_targets_project_name").on(table.projectId, table.name),
    index("deployment_targets_project_updated").on(table.projectId, table.updatedAt),
    check(
      "deployment_targets_current",
      sql`(${table.currentArtifactId} IS NULL) = (${table.currentVersion} IS NULL)`,
    ),
  ],
);
export type DeploymentTargetRow = typeof deploymentTargets.$inferSelect;

export const deploymentBuilds = sqliteTable(
  "deployment_builds",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => deploymentTargets.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    requestKey: text("request_key").notNull(),
    requestedBy: text("requested_by").notNull(),
    status: text("status").$type<import("@larness/shared").DeploymentBuildStatus>().notNull(),
    specJson: text("spec_json").notNull(),
    specHash: text("spec_hash").notNull(),
    reasonCode: text("reason_code"),
    logRef: text("log_ref").notNull(),
    startedAt: integer("started_at"),
    endedAt: integer("ended_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("deployment_builds_request").on(table.requestKey),
    index("deployment_builds_target_created").on(table.targetId, table.createdAt),
    index("deployment_builds_status").on(table.status),
    check(
      "deployment_builds_status",
      sql`${table.status} IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')`,
    ),
  ],
);
export type DeploymentBuildRow = typeof deploymentBuilds.$inferSelect;

export const deploymentArtifacts = sqliteTable(
  "deployment_artifacts",
  {
    id: text("id").primaryKey(),
    buildId: text("build_id")
      .notNull()
      .references(() => deploymentBuilds.id),
    targetId: text("target_id")
      .notNull()
      .references(() => deploymentTargets.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    version: text("version").notNull(),
    artifactHash: text("artifact_hash").notNull(),
    artifactPath: text("artifact_path").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    fileCount: integer("file_count").notNull(),
    specJson: text("spec_json").notNull(),
    specHash: text("spec_hash").notNull(),
    sourceJson: text("source_json").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("deployment_artifacts_build").on(table.buildId),
    uniqueIndex("deployment_artifacts_target_version").on(table.targetId, table.version),
    index("deployment_artifacts_target_created").on(table.targetId, table.createdAt),
    check("deployment_artifacts_hash", sql`length(${table.artifactHash}) = 64`),
    check("deployment_artifacts_size", sql`${table.sizeBytes} >= 0`),
    check("deployment_artifacts_count", sql`${table.fileCount} >= 0`),
  ],
);
export type DeploymentArtifactRow = typeof deploymentArtifacts.$inferSelect;

export const deploymentPlans = sqliteTable(
  "deployment_plans",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => deploymentTargets.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => deploymentArtifacts.id),
    previousArtifactId: text("previous_artifact_id").references(() => deploymentArtifacts.id),
    previousVersion: text("previous_version"),
    version: text("version").notNull(),
    planJson: text("plan_json").notNull(),
    planHash: text("plan_hash").notNull(),
    status: text("status").$type<import("@larness/shared").DeploymentPlanStatus>().notNull(),
    expiresAt: integer("expires_at").notNull(),
    requestKey: text("request_key").notNull(),
    requestedBy: text("requested_by").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("deployment_plans_request").on(table.requestKey),
    index("deployment_plans_target_created").on(table.targetId, table.createdAt),
    index("deployment_plans_status_expires").on(table.status, table.expiresAt),
    check(
      "deployment_plans_status",
      sql`${table.status} IN ('READY', 'WAITING_APPROVAL', 'AUTHORIZED', 'APPLYING', 'HEALTH_CHECK', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED', 'INVALIDATED', 'UNKNOWN')`,
    ),
    check("deployment_plans_hash", sql`length(${table.planHash}) = 64`),
    check(
      "deployment_plans_previous",
      sql`(${table.previousArtifactId} IS NULL) = (${table.previousVersion} IS NULL)`,
    ),
  ],
);
export type DeploymentPlanRow = typeof deploymentPlans.$inferSelect;

export const deploymentAuthorizations = sqliteTable(
  "deployment_authorizations",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => deploymentPlans.id),
    targetId: text("target_id")
      .notNull()
      .references(() => deploymentTargets.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    action: text("action").$type<import("@larness/shared").DeploymentAction>().notNull(),
    actorType: text("actor_type").$type<"human" | "agent">().notNull(),
    actorId: text("actor_id").notNull(),
    clientSessionId: text("client_session_id"),
    sessionId: text("session_id"),
    turnId: text("turn_id"),
    policy: text("policy").$type<import("@larness/shared").DeploymentPolicy>().notNull(),
    policySnapshotId: text("policy_snapshot_id").notNull(),
    status: text("status")
      .$type<import("@larness/shared").DeploymentAuthorizationStatus>()
      .notNull(),
    planHash: text("plan_hash").notNull(),
    artifactHash: text("artifact_hash").notNull(),
    scopeJson: text("scope_json").notNull(),
    scopeHash: text("scope_hash").notNull(),
    approvalId: text("approval_id"),
    requestKey: text("request_key").notNull(),
    expiresAt: integer("expires_at").notNull(),
    decidedAt: integer("decided_at"),
    consumedAt: integer("consumed_at"),
    consumeKey: text("consume_key"),
    reasonCode: text("reason_code"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("deployment_authorizations_request").on(table.requestKey),
    index("deployment_authorizations_plan_status").on(table.planId, table.status),
    index("deployment_authorizations_target_status").on(table.targetId, table.status),
    index("deployment_authorizations_status_expires").on(table.status, table.expiresAt),
    check("deployment_authorizations_action", sql`${table.action} = 'apply'`),
    check("deployment_authorizations_actor", sql`${table.actorType} IN ('human', 'agent')`),
    check(
      "deployment_authorizations_policy",
      sql`${table.policy} IN ('standard', 'strict', 'readonly', 'autonomous')`,
    ),
    check(
      "deployment_authorizations_status",
      sql`${table.status} IN ('PENDING', 'AUTHORIZED', 'DENIED', 'EXPIRED', 'REVOKED', 'CONSUMED', 'INVALIDATED')`,
    ),
    check("deployment_authorizations_plan_hash", sql`length(${table.planHash}) = 64`),
    check("deployment_authorizations_artifact_hash", sql`length(${table.artifactHash}) = 64`),
    check("deployment_authorizations_scope_hash", sql`length(${table.scopeHash}) = 64`),
  ],
);
export type DeploymentAuthorizationRow = typeof deploymentAuthorizations.$inferSelect;

export const deploymentApprovals = sqliteTable(
  "deployment_approvals",
  {
    id: text("id").primaryKey(),
    authorizationId: text("authorization_id")
      .notNull()
      .references(() => deploymentAuthorizations.id),
    planId: text("plan_id")
      .notNull()
      .references(() => deploymentPlans.id),
    targetId: text("target_id")
      .notNull()
      .references(() => deploymentTargets.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    status: text("status").$type<import("@larness/shared").DeploymentApprovalStatus>().notNull(),
    planHash: text("plan_hash").notNull(),
    artifactHash: text("artifact_hash").notNull(),
    requestedBy: text("requested_by").notNull(),
    decidedBy: text("decided_by"),
    expiresAt: integer("expires_at").notNull(),
    decidedAt: integer("decided_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("deployment_approvals_authorization").on(table.authorizationId),
    index("deployment_approvals_status_expires").on(table.status, table.expiresAt),
    check(
      "deployment_approvals_status",
      sql`${table.status} IN ('PENDING', 'APPROVED', 'DENIED', 'EXPIRED', 'REVOKED')`,
    ),
    check("deployment_approvals_plan_hash", sql`length(${table.planHash}) = 64`),
    check("deployment_approvals_artifact_hash", sql`length(${table.artifactHash}) = 64`),
  ],
);
export type DeploymentApprovalRow = typeof deploymentApprovals.$inferSelect;

export const serviceOpsServices = sqliteTable(
  "service_ops_services",
  {
    targetId: text("target_id")
      .primaryKey()
      .references(() => deploymentTargets.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    namespace: text("namespace").notNull(),
    pm2Name: text("pm2_name").notNull().unique(),
    desiredState: text("desired_state")
      .$type<import("@larness/shared").ServiceOpsDesiredState>()
      .notNull(),
    observedState: text("observed_state")
      .$type<import("@larness/shared").ServiceOpsObservedState>()
      .notNull(),
    currentArtifactId: text("current_artifact_id").references(() => deploymentArtifacts.id),
    currentVersion: text("current_version"),
    configJson: text("config_json").notNull(),
    pid: integer("pid"),
    lastHealthAt: integer("last_health_at"),
    reasonCode: text("reason_code"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("service_ops_services_project").on(table.projectId, table.updatedAt),
    check("service_ops_services_desired", sql`${table.desiredState} IN ('running', 'stopped')`),
    check(
      "service_ops_services_observed",
      sql`${table.observedState} IN ('stopped', 'starting', 'running', 'unhealthy', 'stopping', 'failed', 'unknown')`,
    ),
  ],
);
export type ServiceOpsServiceRow = typeof serviceOpsServices.$inferSelect;

export const serviceOpsDeployments = sqliteTable(
  "service_ops_deployments",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => deploymentTargets.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    planId: text("plan_id")
      .notNull()
      .references(() => deploymentPlans.id),
    authorizationId: text("authorization_id")
      .notNull()
      .references(() => deploymentAuthorizations.id),
    artifactId: text("artifact_id")
      .notNull()
      .references(() => deploymentArtifacts.id),
    previousArtifactId: text("previous_artifact_id").references(() => deploymentArtifacts.id),
    previousVersion: text("previous_version"),
    version: text("version").notNull(),
    status: text("status").$type<import("@larness/shared").ServiceOpsDeploymentStatus>().notNull(),
    planHash: text("plan_hash").notNull(),
    artifactHash: text("artifact_hash").notNull(),
    actorType: text("actor_type").$type<"human" | "agent">().notNull(),
    actorId: text("actor_id").notNull(),
    policy: text("policy").$type<import("@larness/shared").DeploymentPolicy>().notNull(),
    policySnapshotId: text("policy_snapshot_id").notNull(),
    reasonCode: text("reason_code"),
    healthJson: text("health_json"),
    resultJson: text("result_json"),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("service_ops_deployments_plan").on(table.planId),
    uniqueIndex("service_ops_deployments_authorization").on(table.authorizationId),
    index("service_ops_deployments_target_created").on(table.targetId, table.createdAt),
    index("service_ops_deployments_status").on(table.status),
    check(
      "service_ops_deployments_status",
      sql`${table.status} IN ('APPLYING', 'HEALTH_CHECK', 'SUCCEEDED', 'FAILED', 'UNKNOWN')`,
    ),
    check("service_ops_deployments_plan_hash", sql`length(${table.planHash}) = 64`),
    check("service_ops_deployments_artifact_hash", sql`length(${table.artifactHash}) = 64`),
    check(
      "service_ops_deployments_previous",
      sql`(${table.previousArtifactId} IS NULL) = (${table.previousVersion} IS NULL)`,
    ),
  ],
);
export type ServiceOpsDeploymentRow = typeof serviceOpsDeployments.$inferSelect;

export const serviceActionAuthorizations = sqliteTable(
  "service_action_authorizations",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id")
      .notNull()
      .references(() => deploymentTargets.id),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    action: text("action").$type<import("@larness/shared").ServiceAction>().notNull(),
    actorType: text("actor_type").$type<"human" | "agent">().notNull(),
    actorId: text("actor_id").notNull(),
    clientSessionId: text("client_session_id"),
    sessionId: text("session_id"),
    turnId: text("turn_id"),
    policy: text("policy").$type<import("@larness/shared").DeploymentPolicy>().notNull(),
    policySnapshotId: text("policy_snapshot_id").notNull(),
    status: text("status").$type<import("@larness/shared").ServiceActionStatus>().notNull(),
    artifactHash: text("artifact_hash").notNull(),
    version: text("version").notNull(),
    scopeJson: text("scope_json").notNull(),
    scopeHash: text("scope_hash").notNull(),
    requestKey: text("request_key").notNull(),
    expiresAt: integer("expires_at").notNull(),
    decidedAt: integer("decided_at"),
    decidedBy: text("decided_by"),
    consumedAt: integer("consumed_at"),
    consumeKey: text("consume_key"),
    reasonCode: text("reason_code"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("service_action_authorizations_request").on(table.requestKey),
    index("service_action_authorizations_target_status").on(table.targetId, table.status),
    index("service_action_authorizations_status_expires").on(table.status, table.expiresAt),
    check(
      "service_action_authorizations_action",
      sql`${table.action} IN ('start', 'stop', 'restart', 'recover')`,
    ),
    check(
      "service_action_authorizations_status",
      sql`${table.status} IN ('PENDING', 'AUTHORIZED', 'DENIED', 'EXPIRED', 'REVOKED', 'CONSUMED')`,
    ),
    check("service_action_authorizations_artifact_hash", sql`length(${table.artifactHash}) = 64`),
    check("service_action_authorizations_scope_hash", sql`length(${table.scopeHash}) = 64`),
  ],
);
export type ServiceActionAuthorizationRow = typeof serviceActionAuthorizations.$inferSelect;
