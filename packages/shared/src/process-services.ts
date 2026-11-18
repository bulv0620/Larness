import { z } from "zod";
import { FilePathSchema } from "./files";

export const NamedServiceIdSchema = z.string().regex(/^svc_[a-f0-9-]{36}$/);
export type NamedServiceId = z.infer<typeof NamedServiceIdSchema>;

export const NamedServiceStatusSchema = z.enum(["STARTING", "RUNNING", "STOPPED", "FAILED"]);
export type NamedServiceStatus = z.infer<typeof NamedServiceStatusSchema>;

const ArgumentSchema = z
  .string()
  .max(8192)
  .refine((value) => !value.includes("\0"));

export const StartServiceParamsSchema = z
  .object({
    name: z.string().min(1).max(80),
    executable: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes("\0")),
    args: z.array(ArgumentSchema).max(256).default([]),
    cwd: FilePathSchema.default("."),
    port: z.number().int().min(1).max(65_535),
    healthPath: z.string().min(1).max(2048).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.args.reduce((size, arg) => size + arg.length, value.executable.length) <= 65_536,
  );
export type StartServiceParams = z.infer<typeof StartServiceParamsSchema>;

export const NamedServiceDtoSchema = z
  .object({
    id: NamedServiceIdSchema,
    projectId: z.string().min(1).max(128),
    sessionId: z.string().min(1).max(128),
    processId: z.string().min(1).max(128),
    name: z.string().min(1).max(80),
    executable: z.string(),
    cwd: z.string(),
    port: z.number().int().min(1).max(65_535),
    status: NamedServiceStatusSchema,
    previewEligible: z.literal(false),
    reasonCode: z.string().nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
    endedAt: z.number().int().nullable(),
  })
  .strict();
export type NamedServiceDto = z.infer<typeof NamedServiceDtoSchema>;

export const ServiceLogsQuerySchema = z
  .object({
    after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
