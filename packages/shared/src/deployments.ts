import { z } from "zod";

const UUID = "[0-9a-f-]{36}";

export const DeploymentTargetIdSchema = z.string().regex(new RegExp(`^tgt_${UUID}$`));
export const DeploymentBuildIdSchema = z.string().regex(new RegExp(`^bld_${UUID}$`));
export const DeploymentArtifactIdSchema = z.string().regex(new RegExp(`^art_${UUID}$`));
export const DeploymentPlanIdSchema = z.string().regex(new RegExp(`^plan_${UUID}$`));
export type DeploymentTargetId = z.infer<typeof DeploymentTargetIdSchema>;
export type DeploymentBuildId = z.infer<typeof DeploymentBuildIdSchema>;
export type DeploymentArtifactId = z.infer<typeof DeploymentArtifactIdSchema>;
export type DeploymentPlanId = z.infer<typeof DeploymentPlanIdSchema>;

export const DeploymentTargetNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "must be a simple service name");
export type DeploymentTargetName = z.infer<typeof DeploymentTargetNameSchema>;
export const DeploymentVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._+-]*$/, "must be a simple version label");
export type DeploymentVersion = z.infer<typeof DeploymentVersionSchema>;

export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
const noControl = (value: string) => !hasControlCharacters(value);

function safeRelative(value: string, allowDot: boolean): boolean {
  if (!value || value.length > 1024 || hasControlCharacters(value) || value.includes("\\"))
    return false;
  if (value === ".") return allowDot;
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export const DeploymentCwdSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => safeRelative(value, true), "must be a relative path inside the project");
export const DeploymentOutputDirSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((value) => safeRelative(value, false), "must be a relative directory inside the project");
export const DeploymentHealthPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (value) => value.startsWith("/") && !value.includes("..") && !hasControlCharacters(value),
    "must be an absolute HTTP path without traversal",
  );

const CommandSchema = z
  .array(z.string().min(1).max(4096).refine(noControl, "must not contain control characters"))
  .min(1)
  .max(64);

export const DeploymentBuildSpecSchema = z.strictObject({
  command: CommandSchema,
  cwd: DeploymentCwdSchema.default("."),
  outputDir: DeploymentOutputDirSchema,
  timeoutMs: z.int().min(1000).max(600_000).default(300_000),
});
export type DeploymentBuildSpec = z.infer<typeof DeploymentBuildSpecSchema>;

export const DeploymentStartSpecSchema = z.strictObject({
  command: CommandSchema,
  cwd: DeploymentCwdSchema.default("."),
});
export type DeploymentStartSpec = z.infer<typeof DeploymentStartSpecSchema>;

export const DeploymentHealthSchema = z.strictObject({
  path: DeploymentHealthPathSchema,
  port: z.int().min(1024).max(65535),
  timeoutMs: z.int().min(1000).max(120_000).default(30_000),
  intervalMs: z.int().min(100).max(10_000).default(500),
});
export type DeploymentHealth = z.infer<typeof DeploymentHealthSchema>;

export const DeploymentRecoverySchema = z.strictObject({
  strategy: z.enum(["restart", "none"]),
  maxAttempts: z.int().min(0).max(10).default(3),
});
export type DeploymentRecovery = z.infer<typeof DeploymentRecoverySchema>;

export const DeploymentSpecSchema = z.strictObject({
  version: DeploymentVersionSchema,
  build: DeploymentBuildSpecSchema,
  start: DeploymentStartSpecSchema,
  health: DeploymentHealthSchema,
  recovery: DeploymentRecoverySchema,
});
export type DeploymentSpec = z.infer<typeof DeploymentSpecSchema>;

export const DeploymentTargetRefSchema = z.union([
  z.strictObject({ targetId: DeploymentTargetIdSchema }),
  z.strictObject({ name: DeploymentTargetNameSchema }),
]);
export type DeploymentTargetRef = z.infer<typeof DeploymentTargetRefSchema>;

export const DeploymentSourceSchema = z.strictObject({
  branch: z.string().max(255).nullable(),
  commit: z.string().max(128).nullable(),
  dirty: z.boolean().nullable(),
});
export type DeploymentSource = z.infer<typeof DeploymentSourceSchema>;

export const DeploymentTargetDtoSchema = z.object({
  id: DeploymentTargetIdSchema,
  projectId: z.string().min(1).max(128),
  name: DeploymentTargetNameSchema,
  currentArtifactId: DeploymentArtifactIdSchema.nullable(),
  currentVersion: DeploymentVersionSchema.nullable(),
  createdAt: z.int(),
  updatedAt: z.int(),
});
export type DeploymentTargetDto = z.infer<typeof DeploymentTargetDtoSchema>;

export const DeploymentBuildStatusSchema = z.enum(["RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]);
export type DeploymentBuildStatus = z.infer<typeof DeploymentBuildStatusSchema>;

export const DeploymentBuildDtoSchema = z.object({
  id: DeploymentBuildIdSchema,
  targetId: DeploymentTargetIdSchema,
  projectId: z.string().min(1).max(128),
  status: DeploymentBuildStatusSchema,
  spec: DeploymentSpecSchema,
  specHash: z.string().regex(/^[a-f0-9]{64}$/),
  reasonCode: z.string().max(64).nullable(),
  logRef: z.string().min(1).max(1024),
  startedAt: z.int().nullable(),
  endedAt: z.int().nullable(),
  createdAt: z.int(),
});
export type DeploymentBuildDto = z.infer<typeof DeploymentBuildDtoSchema>;

export const DeploymentArtifactDtoSchema = z.object({
  id: DeploymentArtifactIdSchema,
  buildId: DeploymentBuildIdSchema,
  targetId: DeploymentTargetIdSchema,
  projectId: z.string().min(1).max(128),
  version: DeploymentVersionSchema,
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.int().nonnegative(),
  fileCount: z.int().nonnegative(),
  source: DeploymentSourceSchema,
  createdAt: z.int(),
});
export type DeploymentArtifactDto = z.infer<typeof DeploymentArtifactDtoSchema>;

export const DeploymentPlanStatusSchema = z.enum([
  "READY",
  "WAITING_APPROVAL",
  "AUTHORIZED",
  "APPLYING",
  "HEALTH_CHECK",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "INVALIDATED",
  "UNKNOWN",
]);
export type DeploymentPlanStatus = z.infer<typeof DeploymentPlanStatusSchema>;

export const DeploymentRecoveryPlanSchema = z.strictObject({
  strategy: z.enum(["restart", "none"]),
  maxAttempts: z.int().min(0).max(10),
  previousArtifactAvailable: z.boolean(),
  databaseRollback: z.literal("unsupported"),
});

export const DeploymentImpactSchema = z.strictObject({
  scope: z.literal("single-service"),
  firstDeploy: z.boolean(),
  restartRequired: z.literal(true),
  downtime: z.literal("brief"),
  replacesVersion: DeploymentVersionSchema.nullable(),
  replacesArtifact: DeploymentArtifactIdSchema.nullable(),
});

export const DeploymentPlanDocumentSchema = z.strictObject({
  version: z.literal(1),
  targetId: DeploymentTargetIdSchema,
  projectId: z.string().min(1).max(128),
  artifactId: DeploymentArtifactIdSchema,
  artifactHash: z.string().regex(/^[a-f0-9]{64}$/),
  artifactVersion: DeploymentVersionSchema,
  previousArtifactId: DeploymentArtifactIdSchema.nullable(),
  previousVersion: DeploymentVersionSchema.nullable(),
  specHash: z.string().regex(/^[a-f0-9]{64}$/),
  source: DeploymentSourceSchema,
  health: DeploymentHealthSchema,
  recovery: DeploymentRecoveryPlanSchema,
  impact: DeploymentImpactSchema,
  expiresAt: z.int().positive(),
});
export type DeploymentPlanDocument = z.infer<typeof DeploymentPlanDocumentSchema>;

export const DeploymentPlanDtoSchema = z.object({
  id: DeploymentPlanIdSchema,
  targetId: DeploymentTargetIdSchema,
  projectId: z.string().min(1).max(128),
  artifactId: DeploymentArtifactIdSchema,
  previousArtifactId: DeploymentArtifactIdSchema.nullable(),
  previousVersion: DeploymentVersionSchema.nullable(),
  version: DeploymentVersionSchema,
  status: DeploymentPlanStatusSchema,
  plan: DeploymentPlanDocumentSchema,
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.int(),
  requestedBy: z.string().min(1).max(128),
  createdAt: z.int(),
});
export type DeploymentPlanDto = z.infer<typeof DeploymentPlanDtoSchema>;

export const DeploymentArtifactManifestSchema = z.strictObject({
  version: z.literal(1),
  artifactId: DeploymentArtifactIdSchema,
  targetId: DeploymentTargetIdSchema,
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  files: z.array(
    z.strictObject({
      path: z.string().min(1).max(1024),
      size: z.int().nonnegative(),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  ),
});
export type DeploymentArtifactManifest = z.infer<typeof DeploymentArtifactManifestSchema>;

export const DEPLOYMENT_PLAN_TTL_MS = 30 * 60_000;
export const DEPLOYMENT_ARTIFACT_MAX_BYTES = 512 * 1024 * 1024;
export const DEPLOYMENT_ARTIFACT_MAX_FILES = 20_000;
export const DEPLOYMENT_ARTIFACT_MAX_PATH = 1024;
export const DEPLOYMENT_ARTIFACT_MAX_DEPTH = 32;
export const DEPLOYMENT_BUILD_LOG_MAX_BYTES = 1024 * 1024;
