import { z } from "zod";
import { FilePathSchema } from "./files";

export const ProcessIdSchema = z.string().regex(/^prc_[a-f0-9-]{36}$/);
export type ProcessId = z.infer<typeof ProcessIdSchema>;

export const ProcessStatusSchema = z.enum([
  "STARTING",
  "RUNNING",
  "STOPPING",
  "EXITED",
  "STOPPED",
  "FAILED",
]);
export type ProcessStatus = z.infer<typeof ProcessStatusSchema>;

const CommandArgumentSchema = z
  .string()
  .max(8192)
  .refine((value) => !value.includes("\0"));

export const StartProcessParamsSchema = z
  .object({
    executable: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes("\0")),
    args: z.array(CommandArgumentSchema).max(256).default([]),
    cwd: FilePathSchema.default("."),
    /** Stable human-readable name used for idempotent restarts. */
    name: z.string().min(1).max(80).optional(),
    /** Port the task will listen on; required for a preview button. */
    port: z.number().int().min(1).max(65_535).optional(),
    /** Optional HTTP health path used by the UI/preview verification. */
    healthPath: z.string().min(1).max(2048).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.args.reduce((size, arg) => size + arg.length, value.executable.length) <= 65_536,
  );
export type StartProcessParams = z.infer<typeof StartProcessParamsSchema>;

export const ProcessOutputQuerySchema = z
  .object({
    after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();

export const ProcessOutputChunkSchema = z
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
export type ProcessOutputChunk = z.infer<typeof ProcessOutputChunkSchema>;

export const ProcessDtoSchema = z
  .object({
    id: ProcessIdSchema,
    projectId: z.string().nullable(),
    sessionId: z.string(),
    name: z.string().nullable(),
    status: ProcessStatusSchema,
    executable: z.string(),
    cwd: z.string(),
    pid: z.number().int().nullable(),
    exitCode: z.number().int().nullable(),
    reasonCode: z.string().nullable(),
    startedAt: z.number().int().nullable(),
    endedAt: z.number().int().nullable(),
    port: z.number().int().min(1).max(65_535).nullable(),
    healthPath: z.string().nullable(),
    previewEligible: z.boolean(),
    outputCursor: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();
export type ProcessDto = z.infer<typeof ProcessDtoSchema>;

export const ProcessOutputPageSchema = z
  .object({
    chunks: z.array(ProcessOutputChunkSchema).max(500),
    oldestCursor: z.number().int().positive(),
    nextCursor: z.number().int().nonnegative(),
    truncated: z.boolean(),
    resyncRequired: z.boolean(),
  })
  .strict();
export type ProcessOutputPage = z.infer<typeof ProcessOutputPageSchema>;

export const PROCESS_OUTPUT_MAX_BYTES = 1024 * 1024;
export const PROCESS_OUTPUT_MAX_CHUNKS = 5000;
