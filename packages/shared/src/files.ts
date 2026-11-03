import { z } from "zod";

export const MAX_EDITABLE_FILE_BYTES = 512 * 1024;
const resourceId = z.string().min(1).max(128);
export const FileScopeSchema = z.union([
  z.object({ projectId: resourceId }).strict(),
  z.object({ sessionId: resourceId }).strict(),
]);
export type FileScope = z.infer<typeof FileScopeSchema>;
export const FilePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => {
    const normalized = value.replaceAll("\\", "/");
    return (
      !normalized.startsWith("/") &&
      !normalized.includes("\0") &&
      normalized.split("/").every((part) => part !== ".." && !part.includes(":"))
    );
  }, "Expected a relative path inside the authorized root")
  .transform((value) => value.replaceAll("\\", "/"));
export const FileVersionSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const FileSaveSchema = z
  .object({
    scope: FileScopeSchema,
    path: FilePathSchema,
    content: z.string().max(1024 * 1024),
    expectedVersion: FileVersionSchema,
  })
  .strict();
export const FileReadQuerySchema = z.union([
  z
    .object({ projectId: resourceId, path: FilePathSchema, version: FileVersionSchema.optional() })
    .strict(),
  z
    .object({ sessionId: resourceId, path: FilePathSchema, version: FileVersionSchema.optional() })
    .strict(),
]);
export const FileListQuerySchema = z
  .object({
    path: FilePathSchema.default("."),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict();
export const FileReadResultSchema = z.object({
  path: z.string(),
  realPath: z.string(),
  content: z.string(),
  version: FileVersionSchema,
  size: z.number().int().nonnegative(),
  encoding: z.literal("utf-8"),
});
export const FileSaveResultSchema = FileReadResultSchema.omit({
  content: true,
  encoding: true,
}).extend({ previousVersion: FileVersionSchema });
export type FileSaveResult = z.infer<typeof FileSaveResultSchema>;
export type FileReadResult = z.infer<typeof FileReadResultSchema>;
export const FileEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(["file", "directory"]),
  size: z.number().int().nonnegative().optional(),
});
export const FileListResultSchema = z.object({
  items: z.array(FileEntrySchema),
  nextCursor: z.string().nullable(),
  revision: FileVersionSchema,
});
export type FileListResult = z.infer<typeof FileListResultSchema>;

export const FileResultTargetSchema = z
  .object({
    kind: z.literal("file"),
    scope: FileScopeSchema,
    path: FilePathSchema,
    version: FileVersionSchema.optional(),
  })
  .strict();
export type FileResultTarget = z.infer<typeof FileResultTargetSchema>;
