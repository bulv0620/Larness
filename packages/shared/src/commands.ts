import { z } from "zod";
import { FilePathSchema } from "./files";

/**
 * A single command may run for up to 30 minutes. The Turn wall clock is the
 * real outer bound (ADR-059): `CommandManager` further clamps this to the time
 * left in the Turn, so a long timeout never outlives its Turn.
 */
export const MAX_COMMAND_TIMEOUT_MS = 1_800_000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 300_000;

const CommandParamsObject = z
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
      .max(256)
      .default([]),
    cwd: FilePathSchema.default("."),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(MAX_COMMAND_TIMEOUT_MS)
      .default(DEFAULT_COMMAND_TIMEOUT_MS),
  })
  .strict();

export const CommandParamsSchema = CommandParamsObject.refine(
  (value) => value.args.reduce((size, arg) => size + arg.length, value.executable.length) <= 65_536,
);
export type CommandParams = z.infer<typeof CommandParamsSchema>;

/** Explicit shell escape hatch. The platform shell is selected by the backend. */
const ShellCommandParamsObject = z
  .object({
    command: z
      .string()
      .min(1)
      .max(65_536)
      .refine((value) => !value.includes("\0")),
    cwd: FilePathSchema.default("."),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(MAX_COMMAND_TIMEOUT_MS)
      .default(DEFAULT_COMMAND_TIMEOUT_MS),
  })
  .strict();

export const ShellCommandParamsSchema = ShellCommandParamsObject;
export type ShellCommandParams = z.infer<typeof ShellCommandParamsSchema>;

/**
 * Internal request consumed by CommandManager. The tools keep `mode` out of
 * their public schemas and set it before calling the shared handler.
 */
export const CommandRequestSchema = z
  .discriminatedUnion("mode", [
    CommandParamsObject.extend({ mode: z.literal("exec") }),
    ShellCommandParamsObject.extend({ mode: z.literal("shell") }),
  ])
  .superRefine((value, context) => {
    if (
      value.mode === "exec" &&
      value.args.reduce((size, arg) => size + arg.length, value.executable.length) > 65_536
    ) {
      context.addIssue({ code: "custom", message: "command arguments exceed the 64 KiB limit" });
    }
  });
export type CommandRequest = z.infer<typeof CommandRequestSchema>;

/**
 * Internal callers may omit `mode`: a `command` field means shell mode, an
 * `executable` field means exec mode. Public tool schemas never expose `mode`.
 */
export function normalizeCommandRequest(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  if ("mode" in input) return input;
  return { ...input, mode: "command" in input ? "shell" : "exec" };
}
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

export const CommandDtoSchema = z.object({
  id: CommandIdSchema,
  scope: z
    .object({ projectId: z.string() })
    .strict()
    .or(z.object({ sessionId: z.string() }).strict()),
  status: CommandStatusSchema,
  exitCode: z.number().nullable(),
  reasonCode: z.string().nullable(),
  truncated: z.boolean(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  currentSequence: z.number().int().nonnegative(),
});
export const CommandOutputPageSchema = z.object({
  chunks: z.array(CommandOutputChunkSchema).max(500),
  oldestCursor: z.number().int().positive(),
  nextCursor: z.number().int().nonnegative(),
  truncated: z.boolean(),
  resyncRequired: z.boolean(),
});
export const CommandOutputEventSchema = CommandOutputChunkSchema.extend({
  kind: z.literal("command.output"),
  resourceId: CommandIdSchema,
}).strict();
export type CommandOutputEvent = z.infer<typeof CommandOutputEventSchema>;
