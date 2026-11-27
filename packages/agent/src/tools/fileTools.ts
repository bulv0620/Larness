import {
  applyPatch as applyFilePatch,
  editTextFile,
  FileError,
  listFiles,
  readTextFile,
  searchCode,
  writeTextFile,
} from "@larness/resources";
import { z } from "zod";
import { ToolRegistry } from "./registry.js";
import { defineTool, type ToolResult } from "./types.js";

const PathSchema = z.string().min(1).max(4_096);
/** One page fits the raised tool-result budget without being re-truncated. */
const READ_PAGE_CHARS = 50_000;
/** Above this, the model gets an explicit hint to narrow the search. */
const BROAD_SEARCH_FILES = 200;

type ReadPage = Awaited<ReturnType<typeof readTextFile>>;
type SearchResult = Awaited<ReturnType<typeof searchCode>>;

/** 1-based line numbers are for reference; they are not part of the file. */
function numberedPage(content: string, offset: number): string {
  const lines = content.split("\n");

  if (lines.at(-1) === "") {
    lines.pop();
  }

  if (lines.length === 0) {
    return "";
  }

  const width = String(offset + lines.length - 1).length;

  return lines
    .map((line, index) => `${String(offset + index).padStart(width, " ")}: ${line}`)
    .join("\n");
}

function readModelText(result: ReadPage): string {
  const page = result.truncated
    ? `\n[lines ${result.offset}–${Math.max(result.offset, result.nextOffset - 1)} of ${result.totalLines}; next offset=${result.nextOffset}]`
    : "";
  const body = numberedPage(result.content, result.offset);

  return `${result.path}\nversion: ${result.version}${body.length === 0 ? "" : `\n${body}`}${page}`;
}

function searchModelText(result: SearchResult): string {
  const header =
    result.matches.length === 0
      ? `No matches in ${result.scannedFiles} files`
      : `${result.matches.length} matches in ${result.scannedFiles} files`;
  const notes = [
    result.scanBudgetExhausted ? "(scan budget reached; results may be incomplete)" : "",
    result.truncated ? "(truncated)" : "",
  ].filter((note) => note.length > 0);
  const lines = result.matches.flatMap((match) => {
    const base = `${match.path}:${match.line}: ${match.preview}`;

    if (match.context === undefined) {
      return [base];
    }

    const context = match.context.split("\n");
    const contextStart = match.contextStart;

    if (contextStart === undefined) {
      return [base, ...context.map((line) => `  ${line}`)];
    }

    return [
      base,
      ...context.flatMap((line, index) => {
        const lineNumber = contextStart + index;
        return lineNumber === match.line ? [] : [`  ${lineNumber}: ${line}`];
      }),
    ];
  });
  const hints =
    result.scannedFiles > BROAD_SEARCH_FILES
      ? [
          `Broad scan: ${result.scannedFiles} files scanned. Narrow with path/glob, or search the exact identifier from the request.`,
        ]
      : [];

  if (result.matches.length > 0) {
    hints.push(
      "Hint: read a narrow window around a match instead of a large page; do not repeat the same search for a case variant.",
    );
  }

  return [`${header}${notes.length === 0 ? "" : ` ${notes.join(" ")}`}`, ...lines, ...hints].join(
    "\n",
  );
}

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
    contextLines: z.number().int().min(0).max(5).default(1),
    glob: z.string().min(1).max(200).optional(),
    maxFiles: z.number().int().min(1).max(20_000).optional(),
  })
  .strict();

const WriteFileSchema = z
  .object({
    path: PathSchema,
    content: z.string().max(1_048_576),
    expectedVersion: z
      .string()
      .regex(/^[a-f0-9]{64}$/, "expectedVersion must be a sha256 hex")
      .optional(),
  })
  .strict();

const EditFileSchema = z
  .object({
    path: PathSchema,
    oldString: z.string().min(1).max(1_048_576),
    newString: z.string().max(1_048_576),
    replaceAll: z.boolean().optional(),
  })
  .strict();

const ApplyPatchSchema = z
  .object({
    path: PathSchema,
    expectedVersion: z.string().regex(/^[a-f0-9]{64}$/, "expectedVersion must be a sha256 hex"),
    patch: z.string().min(1).max(1_048_576),
  })
  .strict();

/**
 * Models occasionally send a field alias instead of the documented name.
 * Normalize the alias and drop it: the schema is strict.
 */
function repairPatchArgs(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;

  const repaired: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  if (typeof repaired.path !== "string") {
    for (const key of ["file_path", "file", "filename"] as const) {
      if (typeof repaired[key] === "string") {
        repaired.path = repaired[key];
        break;
      }
    }
  }

  if (typeof repaired.patch !== "string" && typeof repaired.diff === "string") {
    repaired.patch = repaired.diff;
  }

  for (const key of ["file_path", "file", "filename", "diff"]) delete repaired[key];

  return repaired;
}

function repairEditArgs(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;

  const repaired: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  if (typeof repaired.path !== "string") {
    for (const key of ["file_path", "file", "filename"] as const) {
      if (typeof repaired[key] === "string") {
        repaired.path = repaired[key];
        break;
      }
    }
  }

  if (typeof repaired.oldString !== "string" && typeof repaired.old_string === "string") {
    repaired.oldString = repaired.old_string;
  }
  if (typeof repaired.newString !== "string" && typeof repaired.new_string === "string") {
    repaired.newString = repaired.new_string;
  }
  if (typeof repaired.replaceAll !== "boolean" && typeof repaired.replace_all === "boolean") {
    repaired.replaceAll = repaired.replace_all;
  }

  for (const key of [
    "file_path",
    "file",
    "filename",
    "old_string",
    "new_string",
    "replace_all",
    // Models sometimes confuse edit with apply_patch/write_file. edit checks
    // the version internally, so these fields are safe to ignore.
    "expectedVersion",
    "version",
  ]) {
    delete repaired[key];
  }

  return repaired;
}

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
      description:
        "List files and directories inside the authorized project root. Common build/output directories (`.git`, `node_modules`, `dist`, `build`, `coverage`, `test-results`, `tmp`, `.turbo`, `.vite`, `.pnpm-store`) are skipped; pass `path` to inspect one explicitly.",
      riskLevel: "L0",
      requiresProjectLock: false,
      prefetchable: true,
      schema: ListFilesSchema,
      summarize: (args) => `list ${args.path ?? "."}`,
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
        "Read a UTF-8 text file inside the project. Each text line is prefixed by its 1-based line number as `<line>: <content>`; the prefix is for reference only and is not part of the file content. Returns a contiguous page of up to 50 KB or 2000 lines, the full sha256 `version` for later patches, and `nextOffset` when more lines remain.",
      riskLevel: "L0",
      requiresProjectLock: false,
      prefetchable: true,
      schema: ReadFileSchema,
      summarize: (args) => `read ${args.path}`,
      async handler(args, context) {
        try {
          const result = await readTextFile(context.projectRoot, {
            path: args.path,
            maxChars: READ_PAGE_CHARS,
            ...(args.offset === undefined ? {} : { offset: args.offset }),
            ...(args.limit === undefined ? {} : { limit: args.limit }),
          });
          const page = result.truncated
            ? `; lines ${result.offset}–${Math.max(result.offset, result.nextOffset - 1)} of ${result.totalLines}, next offset=${result.nextOffset}`
            : "";

          return {
            ok: true,
            summary: `read ${result.path} (${result.totalLines} lines, version ${result.version.slice(0, 12)})${page}`,
            data: result,
            truncated: result.truncated,
            modelText: readModelText(result),
          };
        } catch (error) {
          return fileFailure(error);
        }
      },
    }),
    defineTool({
      name: "search_code",
      description:
        "Search for a literal string in project text files. Common build/output directories (`.git`, `node_modules`, `dist`, `build`, `coverage`, `test-results`, `tmp`, `.turbo`, `.vite`, `.pnpm-store`) are skipped; pass `path` explicitly to search inside one. Each match includes one line of context by default; set contextLines (0-5) for more, or 0 to disable. When a match identifies the target, read a narrow window around its line instead of a large page, and do not repeat the same search. Very large scans are a signal to pass path/glob or search the exact identifier from the request.",
      riskLevel: "L0",
      requiresProjectLock: false,
      prefetchable: true,
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
            modelText: searchModelText(result),
          };
        } catch (error) {
          return fileFailure(error);
        }
      },
    }),
    defineTool({
      name: "write_file",
      description:
        "Create or completely replace a text file inside the project; parent directories are created. Path is project-relative and content is limited to 1 MiB. For a targeted change to an existing file, prefer edit. If the file exists and you pass `expectedVersion` from read_file, the write fails with VERSION_CONFLICT when it changed; without it, the file is replaced. Put scratch files (probes, scripts) under tmp/ and delete them before the Turn ends: temporary and generated paths are folded into process files, not results.",
      riskLevel: "L1",
      schema: WriteFileSchema,
      summarize: (args) => `write ${args.path}`,
      async handler(args, context) {
        try {
          const result = await writeTextFile(context.projectRoot, {
            path: args.path,
            content: args.content,
            ...(args.expectedVersion === undefined
              ? {}
              : { expectedVersion: args.expectedVersion }),
          });

          return {
            ok: true,
            summary: `${result.created ? "created" : "wrote"} ${result.path} (${result.lines} lines, version ${result.version.slice(0, 12)})`,
            data: result,
          };
        } catch (error) {
          return fileFailure(error);
        }
      },
    }),
    defineTool({
      name: "edit",
      description:
        "Replace exact text in an existing text file. `oldString` must match exactly once unless `replaceAll` is true; include more surrounding context to make it unique. The values must differ. Line numbers shown by read_file are for reference only and must not be included in `oldString`. CRLF files accept LF-only input. Returns the new sha256 version; a concurrent change fails with VERSION_CONFLICT.",
      riskLevel: "L1",
      schema: EditFileSchema,
      repairArgs: repairEditArgs,
      summarize: (args) => `edit ${args.path}`,
      async handler(args, context) {
        try {
          const result = await editTextFile(context.projectRoot, {
            path: args.path,
            oldString: args.oldString,
            newString: args.newString,
            ...(args.replaceAll === undefined ? {} : { replaceAll: args.replaceAll }),
          });

          return {
            ok: true,
            summary: `edited ${result.path} (${result.replacements} replacement${result.replacements === 1 ? "" : "s"}, version ${result.version.slice(0, 12)})`,
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
        "Apply a unified diff to an existing file. Prefer edit for a targeted change. Requires the full sha256 version returned by read_file. Send real newlines inside the `patch` string (JSON `\\n` escapes are decoded for you) and keep the diff minimal: at least one `@@ -start,count +start,count @@` hunk with exact context lines. Line numbers shown by read_file are for reference only; do not include them in the patch. `--- a/<path>` / `+++ b/<path>` headers are optional; code fences, prose and CRLF are tolerated. Context must match the current file exactly — a stale version fails with VERSION_CONFLICT.",
      riskLevel: "L1",
      schema: ApplyPatchSchema,
      repairArgs: repairPatchArgs,
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
