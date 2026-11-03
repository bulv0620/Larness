import { z } from "zod";
import { FilePathSchema } from "./files";
export const CommandParamsSchema = z
  .object({
    executable: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes("\0")),
    args: z
      .array(
        z
          .string()
          .max(8192)
          .refine((value) => !value.includes("\0")),
      )
      .max(256),
    cwd: FilePathSchema.default("."),
    timeoutMs: z.number().int().min(1).max(600_000).default(120_000),
  })
  .strict()
  .refine(
    (value) =>
      value.args.reduce((size, arg) => size + arg.length, value.executable.length) <= 65_536,
  );
export type CommandParams = z.infer<typeof CommandParamsSchema>;
export const CommandStatusSchema = z.enum([
  "CREATED",
  "RUNNING",
  "CANCELLING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "TIMED_OUT",
  "INTERRUPTED",
]);
export type CommandStatus = z.infer<typeof CommandStatusSchema>;
export const CommandOutputQuerySchema = z
  .object({
    after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
export const CommandOutputChunkSchema = z
  .object({
    cursor: z.number().int().positive(),
    data: z
      .string()
      .max(16 * 1024)
      .refine((data) => new TextEncoder().encode(data).byteLength <= 16 * 1024),
    channel: z.enum(["stdout", "stderr"]),
    timestamp: z.number().int(),
  })
  .strict();
export const CommandStatusPayloadSchema = z.object({
  status: CommandStatusSchema,
  exitCode: z.number().int().nullable(),
  reasonCode: z.string().nullable(),
  truncated: z.boolean(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
});
export const CommandCancelSchema = z.object({}).strict();
export const COMMAND_OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60_000;
export const COMMAND_RETENTION_MS = 30 * 24 * 60 * 60_000;

export const CommandIdSchema = z.string().regex(/^cmd_[a-f0-9-]{36}$/);
export const CommandSubscriptionSchema = z
  .object({
    topic: z.literal("command"),
    resourceId: CommandIdSchema,
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  })
  .strict();

export const CommandStatusEventSchema = z.object({
  kind: z.literal("event"),
  protocolVersion: z.literal(1),
  topic: z.literal("command"),
  eventId: z.string(),
  streamId: CommandIdSchema,
  resourceId: CommandIdSchema,
  sequence: z.number().int().nonnegative(),
  timestamp: z.number(),
  type: z.literal("command.status"),
  payload: CommandStatusPayloadSchema,
});
