import {
  applyPatch as applyFilePatch,
  createTextFile,
  FileError,
  listFiles,
  readTextFile,
  searchCode,
} from "@larness/resources";
import { z } from "zod";
import { ToolRegistry } from "./registry.js";
import { defineTool, type ToolResult } from "./types.js";

const PathSchema = z.string().min(1).max(4_096);

const ListFilesSchema = z
  .object({
    path: PathSchema.default("."),
    depth: z.number().int().min(1).max(10).optional(),
    limit: z.number().int().min(1).max(2_000).optional(),
  })
  .strict();

const ReadFileSchema = z
  .object({
    path: PathSchema,
    offset: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(2_000).optional(),
  })
  .strict();

const SearchCodeSchema = z
  .object({
    query: z.string().min(1).max(500),
    path: PathSchema.optional(),
    limit: z.number().int().min(1).max(500).optional(),
    caseSensitive: z.boolean().optional(),
    contextLines: z.number().int().min(0).max(5).optional(),
    glob: z.string().min(1).max(200).optional(),
    maxFiles: z.number().int().min(1).max(20_000).optional(),
  })
  .strict();

const WriteFileSchema = z
  .object({
    path: PathSchema,
    content: z.string().max(1_048_576),
  })
  .strict();

const ApplyPatchSchema = z
  .object({
    path: PathSchema,
    expectedVersion: z.string().regex(/^[a-f0-9]{64}$/, "expectedVersion must be a sha256 hex"),
    patch: z.string().min(1).max(1_048_576),
  })
  .strict();

function fileFailure(error: unknown): ToolResult {
  if (error instanceof FileError) {
    return {
      ok: false,
      errorCode: error.code,
      summary: error.message,
      ...(error.details === undefined ? {} : { data: error.details }),
    };
  }

  return { ok: false, errorCode: "TOOL_ERROR", summary: "file tool failed" };
}

export function createFileTools() {
  return [
    defineTool({
      name: "list_files",
      description: "List files and directories inside the authorized project root.",
      riskLevel: "L0",
      schema: ListFilesSchema,
      summarize: (args) => `list ${args.path}`,
      async handler(args, context) {
        try {
          const result = await listFiles(context.projectRoot, {
            path: args.path,
            ...(args.depth === undefined ? {} : { depth: args.depth }),
            ...(args.limit === undefined ? {} : { limit: args.limit }),
            ...(context.ignore === undefined ? {} : { ignore: context.ignore }),
          });

          return {
            ok: true,
            summary: `${result.files.length} entries${result.truncated ? " (truncated)" : ""}`,
            data: result,
            truncated: result.truncated,
          };
        } catch (error) {
          return fileFailure(error);
        }
      },
    }),
    defineTool({
      name: "read_file",
      description:
        "Read a UTF-8 text file inside the project. Returns content and a sha256 version for later patches.",
      riskLevel: "L0",
      schema: ReadFileSchema,
      summarize: (args) => `read ${args.path}`,
      async handler(args, context) {
        try {
          const result = await readTextFile(context.projectRoot, {
            path: args.path,
            ...(args.offset === undefined ? {} : { offset: args.offset }),
            ...(args.limit === undefined ? {} : { limit: args.limit }),
          });

          return {
            ok: true,
            summary: `read ${result.path} (${result.totalLines} lines, version ${result.version.slice(0, 12)})`,
            data: result,
            truncated: result.truncated,
          };
        } catch (error) {
          return fileFailure(error);
        }
      },
    }),
    defineTool({
      name: "search_code",
      description:
        "Search for a literal string in project text files. Narrow the scan with path, glob and maxFiles, and ask for contextLines to see the surrounding code instead of repeated reads.",
      riskLevel: "L0",
      schema: SearchCodeSchema,
      summarize: (args) => `search ${args.query}`,
      async handler(args, context) {
        try {
          const result = await searchCode(context.projectRoot, {
            query: args.query,
            ...(args.path === undefined ? {} : { path: args.path }),
            ...(args.limit === undefined ? {} : { limit: args.limit }),
            ...(args.caseSensitive === undefined ? {} : { caseSensitive: args.caseSensitive }),
            ...(args.contextLines === undefined ? {} : { contextLines: args.contextLines }),
            ...(args.glob === undefined ? {} : { glob: args.glob }),
            ...(args.maxFiles === undefined ? {} : { maxFiles: args.maxFiles }),
            ...(context.ignore === undefined ? {} : { ignore: context.ignore }),
          });

          return {
            ok: true,
            summary: `${result.matches.length} matches in ${result.scannedFiles} files${
              result.scanBudgetExhausted ? " (scan budget reached; results may be incomplete)" : ""
            }${result.truncated ? " (truncated)" : ""}`,
            data: result,
            truncated: result.truncated,
          };
        } catch (error) {
          return fileFailure(error);
        }
      },
    }),
    defineTool({
      name: "write_file",
      description:
        "Create a NEW text file inside the project. Parent directories are created. Fails with VERSION_CONFLICT when the file already exists — read it and use apply_patch to change it. Path must be project-relative. Content is limited to 1 MiB.",
      riskLevel: "L1",
      schema: WriteFileSchema,
      summarize: (args) => `create ${args.path}`,
      async handler(args, context) {
        try {
          const result = await createTextFile(context.projectRoot, {
            path: args.path,
            content: args.content,
          });

          return {
            ok: true,
            summary: `created ${result.path} (${result.lines} lines, version ${result.version.slice(0, 12)})`,
            data: result,
          };
        } catch (error) {
          return fileFailure(error);
        }
      },
    }),
    defineTool({
      name: "apply_patch",
      description:
        "Apply a unified diff to an existing file. Requires the sha256 version returned by read_file. Send real newlines inside the `patch` string (JSON `\\n` escapes are decoded for you) and keep the diff minimal: at least one `@@ -start,count +start,count @@` hunk with exact context lines. `--- a/<path>` / `+++ b/<path>` headers are optional; code fences, prose and CRLF are tolerated. Context must match the current file exactly — a stale version fails with VERSION_CONFLICT.",
      riskLevel: "L1",
      schema: ApplyPatchSchema,
      summarize: (args) => `patch ${args.path}`,
      async handler(args, context) {
        try {
          const result = await applyFilePatch(context.projectRoot, {
            path: args.path,
            expectedVersion: args.expectedVersion,
            patch: args.patch,
          });

          return {
            ok: true,
            summary: `patched ${result.path} (+${result.additions} -${result.deletions})`,
            data: result,
          };
        } catch (error) {
          return fileFailure(error);
        }
      },
    }),
  ];
}

export function createFileToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  for (const tool of createFileTools()) {
    registry.register(tool);
  }

  return registry;
}
