import { z } from "zod";

export const MEMORY_SCOPES = ["project", "global"] as const;
export const MEMORY_KINDS = ["fact", "command", "gotcha", "decision", "preference"] as const;
export const MEMORY_STATUSES = [
  "active",
  "review",
  "rejected",
  "superseded",
  "expired",
  "evicted",
] as const;
export const MEMORY_EVIDENCE_KINDS = [
  "user_statement",
  "command_succeeded",
  "file_observed",
  "failure_then_success",
  "agent_inference",
] as const;

export const MemoryScopeSchema = z.enum(MEMORY_SCOPES);
export const MemoryKindSchema = z.enum(MEMORY_KINDS);
export const MemoryStatusSchema = z.enum(MEMORY_STATUSES);
export const MemoryEvidenceKindSchema = z.enum(MEMORY_EVIDENCE_KINDS);

export const MemoryKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{2,79}$/, "key must be a lowercase slug");
export const MemoryTitleSchema = z.string().trim().min(1).max(120);
export const MemoryBodySchema = z.string().trim().min(1).max(4_000);

export const MemoryEvidenceSchema = z
  .object({
    kind: MemoryEvidenceKindSchema,
    turnId: z.string().min(1).max(128),
    eventSeq: z.number().int().positive(),
    /** Exact user text for `user_statement`; validated against the source event. */
    quote: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const RememberInputSchema = z
  .object({
    scope: MemoryScopeSchema,
    kind: MemoryKindSchema,
    key: MemoryKeySchema,
    title: MemoryTitleSchema,
    body: MemoryBodySchema,
    evidence: MemoryEvidenceSchema,
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export type RememberInput = z.infer<typeof RememberInputSchema>;

/** Model-facing shape: turn/event ids are resolved server-side from the current Turn. */
export const RememberToolInputSchema = z
  .object({
    scope: MemoryScopeSchema,
    kind: MemoryKindSchema,
    key: MemoryKeySchema,
    title: MemoryTitleSchema,
    body: MemoryBodySchema,
    evidence: z
      .object({
        kind: MemoryEvidenceKindSchema,
        quote: z.string().min(1).max(2_000).optional(),
      })
      .strict(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export type RememberToolInput = z.infer<typeof RememberToolInputSchema>;

export const ReadMemoryInputSchema = z
  .object({
    keys: z.array(MemoryKeySchema).min(1).max(5).optional(),
    query: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(5).optional(),
  })
  .strict();

export type ReadMemoryInput = z.infer<typeof ReadMemoryInputSchema>;

export const MemoryDtoSchema = z.object({
  id: z.string(),
  scope: MemoryScopeSchema,
  projectId: z.string().nullable(),
  kind: MemoryKindSchema,
  key: z.string(),
  title: z.string(),
  body: z.string(),
  status: MemoryStatusSchema,
  confidence: z.number(),
  evidenceKind: MemoryEvidenceKindSchema,
  sourceTurnId: z.string().nullable(),
  sourceEventSeq: z.number().nullable(),
  createdBy: z.enum(["agent", "user"]),
  useCount: z.number(),
  lastUsedAt: z.number().nullable(),
  lastConfirmedAt: z.number().nullable(),
  correctionCount: z.number(),
  pinned: z.boolean(),
  bytes: z.number(),
  verifiedAt: z.number().nullable(),
  expiresAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  stale: z.boolean(),
  revisionCount: z.number(),
});

export type MemoryDto = z.infer<typeof MemoryDtoSchema>;

export const MemoryLimitsSchema = z.object({
  activeBytes: z.number(),
  totalBytes: z.number(),
  activeCount: z.number(),
});

export type MemoryLimits = z.infer<typeof MemoryLimitsSchema>;

export const MemoryBudgetSchema = z.object({
  scope: MemoryScopeSchema,
  projectId: z.string().nullable(),
  activeBytes: z.number(),
  totalBytes: z.number(),
  activeCount: z.number(),
  reviewCount: z.number(),
  evictedCount: z.number(),
  limits: MemoryLimitsSchema,
});

export type MemoryBudget = z.infer<typeof MemoryBudgetSchema>;

export const MEMORY_CHANGED_ACTIONS = [
  "learned",
  "updated",
  "reviewed",
  "forgotten",
  "evicted",
  "restored",
  "purged",
] as const;

export const MemoryChangedActionSchema = z.enum(MEMORY_CHANGED_ACTIONS);
export type MemoryChangedAction = z.infer<typeof MemoryChangedActionSchema>;

export const MemoryChangedPayloadSchema = z.object({
  scope: MemoryScopeSchema,
  projectId: z.string().optional(),
  memoryId: z.string(),
  action: MemoryChangedActionSchema,
  status: MemoryStatusSchema,
});

export type MemoryChangedPayload = z.infer<typeof MemoryChangedPayloadSchema>;
