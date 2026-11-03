import { z } from "zod";
import { FilePathSchema, FileVersionSchema } from "./files";
export const RESOURCE_EVENT_RETENTION_MS = 30 * 24 * 60 * 60_000;

export const FileResourceIdSchema = z.string().regex(/^(project|session):[a-zA-Z0-9_-]{1,128}$/);
export const FileStreamIdSchema = z.string().regex(/^file:(project|session):[a-zA-Z0-9_-]{1,128}$/);
export const FileSubscriptionSchema = z
  .object({
    topic: z.literal("file"),
    resourceId: FileResourceIdSchema,
    paths: z.array(FilePathSchema).min(1).max(128).default(["."]),
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  })
  .strict();
export const ResourceEventsQuerySchema = z
  .object({
    streamId: FileStreamIdSchema,
    after: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  })
  .strict();
export const FileChangedPayloadSchema = z.object({
  path: FilePathSchema,
  version: FileVersionSchema.optional(),
  changeType: z.enum(["created", "modified", "deleted"]),
});
export const FileResyncPayloadSchema = z.object({
  reasonCode: z.enum([
    "WATCH_UNAVAILABLE",
    "WATCH_LIMIT",
    "SCAN_LIMIT",
    "QUEUE_OVERFLOW",
    "ROOT_UNAVAILABLE",
    "DIRECTORY_REPLACED",
    "RECOVERED",
    "SCAN_FAILED",
  ]),
});
export type FileResyncReason = z.infer<typeof FileResyncPayloadSchema>["reasonCode"];
