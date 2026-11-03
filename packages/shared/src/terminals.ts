import { z } from "zod";
import { CommandParamsSchema } from "./commands";
import { FilePathSchema, FileScopeSchema } from "./files";
export const TerminalIdSchema = z.string().regex(/^term_[a-f0-9-]{36}$/);
export const TerminalStatusSchema = z.enum([
  "CREATED",
  "RUNNING",
  "STOPPING",
  "EXITED",
  "TERMINATED",
  "INTERRUPTED",
]);
export type TerminalStatus = z.infer<typeof TerminalStatusSchema>;
export const TerminalCreateSchema = z
  .object({
    scope: FileScopeSchema.optional(),
    cwd: FilePathSchema.default("."),
    sourceSessionId: z.string().min(1).max(128).optional(),
    riskAcknowledged: z.literal(true),
  })
  .strict();
export const TerminalDevSchema = z
  .object({
    role: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    executable: z.string(),
    args: z.array(z.string()),
    cwd: FilePathSchema.default("."),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !CommandParamsSchema.safeParse(
        value && { executable: value.executable, args: value.args, cwd: value.cwd },
      ).success
    )
      ctx.addIssue({ code: "custom", message: "Invalid program parameters" });
  });
export const TerminalLeaseSchema = z
  .object({
    action: z.enum(["acquire", "renew", "release"]),
    connectionId: z.string().uuid(),
    leaseGeneration: z.number().int().positive().optional(),
  })
  .strict();
export const TerminalResizeSchema = z
  .object({
    connectionId: z.string().uuid(),
    leaseGeneration: z.number().int().positive(),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(1).max(300),
  })
  .strict();
export const TerminalInputSchema = z
  .object({
    type: z.literal("terminal.input"),
    terminalId: TerminalIdSchema,
    leaseGeneration: z.number().int().positive(),
    inputSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    data: z
      .string()
      .max(8192)
      .refine((data) => new TextEncoder().encode(data).length <= 8192),
  })
  .strict();
export const TerminalSubscriptionSchema = z
  .object({
    topic: z.literal("terminal"),
    resourceId: TerminalIdSchema,
    after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
  })
  .strict();
export const TerminalOutputChunkSchema = z
  .object({
    cursor: z.number().int().positive(),
    data: z
      .string()
      .max(16384)
      .refine((data) => new TextEncoder().encode(data).length <= 16384),
    timestamp: z.number().int(),
  })
  .strict();
export type TerminalOutputChunk = z.infer<typeof TerminalOutputChunkSchema>;
export const TerminalOutputEventSchema = TerminalOutputChunkSchema.extend({
  kind: z.literal("terminal.output"),
  resourceId: TerminalIdSchema,
}).strict();
export type TerminalOutputEvent = z.infer<typeof TerminalOutputEventSchema>;
export const TerminalLeaseViewSchema = z.object({
  ownerType: z.enum(["human", "agent"]),
  ownerClientSessionId: z.string(),
  ownerConnectionId: z.string().nullable(),
  ownerTurnId: z.string().nullable(),
  ownerExecutionId: z.string().nullable(),
  generation: z.number().int().positive(),
  expiresAt: z.number().int(),
});
export const TerminalPayloadSchema = z.object({
  status: TerminalStatusSchema,
  exitCode: z.number().int().nullable(),
  reasonCode: z.string().nullable(),
  lease: TerminalLeaseViewSchema.nullable(),
});
export const TerminalEventSchema = z.object({
  kind: z.literal("event"),
  protocolVersion: z.literal(1),
  topic: z.literal("terminal"),
  eventId: z.string(),
  streamId: TerminalIdSchema,
  resourceId: TerminalIdSchema,
  sequence: z.number().int().positive(),
  timestamp: z.number(),
  type: z.enum(["terminal.created", "terminal.status", "terminal.exit", "terminal.lease"]),
  payload: TerminalPayloadSchema,
});
export const TERMINAL_LEASE_TTL_MS = 30000;

export const TerminalSchema = z.object({
  writeBlocked: z.boolean(),
  id: TerminalIdSchema,
  projectId: z.string().nullable(),
  workspaceSessionId: z.string().nullable(),
  sourceSessionId: z.string().nullable(),
  cwd: z.string(),
  shell: z.string(),
  mode: z.enum(["shell", "dev"]),
  role: z.string().nullable(),
  status: TerminalStatusSchema,
  exitCode: z.number().nullable(),
  reasonCode: z.string().nullable(),
  currentSequence: z.number().int(),
  lease: TerminalLeaseViewSchema.nullable(),
});
export type LiveTerminal = z.infer<typeof TerminalSchema>;
export const OutputSchema = z.object({
  chunks: z.array(TerminalOutputChunkSchema).max(500),
  nextCursor: z.number().int(),
  oldestCursor: z.number().int(),
  truncated: z.boolean(),
  resyncRequired: z.boolean(),
});

export const TerminalSubscribeAckSchema = z.object({
  kind: z.literal("subscribed"),
  connectionId: z.string().uuid(),
  subscription: z.object({ topic: z.literal("terminal"), resourceId: z.string() }),
});
export const TerminalInputAckSchema = z.object({
  kind: z.literal("terminal.input.ack"),
  inputSequence: z.number().int(),
  accepted: z.boolean(),
});
export const TerminalErrorSchema = z.object({ kind: z.literal("error"), code: z.string() });

export const TerminalListSchema = z.object({
  items: z.array(TerminalSchema),
  nextCursor: TerminalIdSchema.nullable(),
});
