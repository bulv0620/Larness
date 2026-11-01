import {
  applyPatch as applyFilePatch,
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
      description: "Search for a literal string in project text files.",
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
            ...(context.ignore === undefined ? {} : { ignore: context.ignore }),
          });

          return {
            ok: true,
            summary: `${result.matches.length} matches in ${result.scannedFiles} files${
              result.truncated ? " (truncated)" : ""
            }`,
            data: result,
            truncated: result.truncated,
          };
        } catch (error) {
          return fileFailure(error);
        }
      },
    }),
    defineTool({
      name: "apply_patch",
      description:
        "Apply a unified diff to an existing file. Requires the sha256 version returned by read_file.",
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
