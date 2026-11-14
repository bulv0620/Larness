import { z } from "zod";

export const WorkspaceKindSchema = z.enum(["project", "default", "session"]);

export const MAX_EDITABLE_FILE_BYTES = 512 * 1024;
const resourceId = z.string().min(1).max(128);
export const FileScopeSchema = z.union([
  z.object({ workspace: z.literal("default") }).strict(),
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
    .object({
      workspace: z.literal("default"),
      path: FilePathSchema,
      version: FileVersionSchema.optional(),
    })
    .strict(),
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
  entryVersion: FileVersionSchema.optional(),
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

export const FileSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(128),
  })
  .strict();
export const FileSearchResultSchema = z.object({
  items: z.array(FileEntrySchema.pick({ path: true, name: true })).max(60),
  partial: z.boolean(),
});
export type FileSearchResult = z.infer<typeof FileSearchResultSchema>;

const fileActionTarget = { scope: FileScopeSchema, path: FilePathSchema };
export const FileActionSchema = z.discriminatedUnion("action", [
  z.object({ ...fileActionTarget, action: z.literal("createFile") }).strict(),
  z.object({ ...fileActionTarget, action: z.literal("createDirectory") }).strict(),
  z
    .object({
      ...fileActionTarget,
      action: z.literal("deleteFile"),
      confirmed: z.literal(true),
      expectedVersion: FileVersionSchema,
    })
    .strict(),
  z
    .object({
      ...fileActionTarget,
      action: z.literal("move"),
      destination: FilePathSchema,
      expectedVersion: FileVersionSchema,
    })
    .strict(),
]);
export type FileAction = z.infer<typeof FileActionSchema>;
export const FileActionResultSchema = z.object({
  path: FilePathSchema,
  realPath: z.string(),
  previousPath: FilePathSchema.optional(),
  previousRealPath: z.string().optional(),
});
export type FileActionResult = z.infer<typeof FileActionResultSchema>;
