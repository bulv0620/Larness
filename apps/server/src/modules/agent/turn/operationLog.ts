import type { EncryptedSecretRef } from "@larness/agent";
import { OutputRedactor } from "@larness/resources";
import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../../db/client.js";
import { agentEvents } from "../../../db/schema.js";
import type { SecretStore } from "../../../security/secretStore.js";
import { secretVerdict } from "../secretGuard.js";
import { estimateTextTokens } from "../tokenEstimator.js";

export const MAX_OPERATIONS = 40;
export const MAX_OPERATION_TOKENS = 2_500;
export const MAX_COMMAND_TAIL_CHARS = 800;
export const MAX_OPERATION_ARGS_CHARS = 400;

const commandSchema = z
  .object({
    display: z.string().min(1).max(MAX_OPERATION_ARGS_CHARS),
    exitCode: z.number().int().nullable(),
    outputTail: z.string().max(MAX_COMMAND_TAIL_CHARS).optional(),
    truncated: z.boolean().optional(),
  })
  .strict();

const fileSchema = z
  .object({
    path: z.string().min(1).max(4_096),
    version: z.string().regex(/^[a-f0-9]{64}$/),
    changeType: z.enum(["created", "modified"]).optional(),
    additions: z.number().int().min(0).optional(),
    deletions: z.number().int().min(0).optional(),
    replacements: z.number().int().min(0).optional(),
  })
  .strict();

const operationSchema = z
  .object({
    toolCallId: z.string().min(1).max(200),
    toolName: z.string().min(1).max(100),
    ok: z.boolean(),
    summary: z.string().max(500),
    argsSummary: z.string().max(MAX_OPERATION_ARGS_CHARS).optional(),
    errorCode: z.string().max(100).optional(),
    command: commandSchema.optional(),
    file: fileSchema.optional(),
  })
  .strict();

export type ToolOperationRecord = z.infer<typeof operationSchema>;
export type CommandOperation = z.infer<typeof commandSchema>;
export type FileOperation = z.infer<typeof fileSchema>;

function clipLine(text: string, maxChars: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= maxChars ? oneLine : `${oneLine.slice(0, maxChars)}…`;
}

function clipTail(text: string, maxChars = MAX_COMMAND_TAIL_CHARS): string {
  const compact = text.length <= maxChars ? text : text.slice(-maxChars);
  return clipLine(compact, maxChars);
}

/**
 * Redacts secret-shaped values and drops the text when it contains a known
 * credential. Callers store the result, never the plaintext input.
 */
export function redactOperationText(
  text: string,
  secrets: EncryptedSecretRef[],
  secretStore: SecretStore | undefined,
): string | null {
  if (secretVerdict([text], secrets, secretStore) !== "ok") {
    return null;
  }

  return new OutputRedactor([]).push(text, true);
}

export function buildToolOperation(input: {
  toolCallId: string;
  toolName: string;
  ok: boolean;
  summary: string;
  argsSummary?: string;
  errorCode?: string;
  command?: {
    display: string;
    exitCode: number | null;
    outputTail?: string;
    truncated?: boolean;
  };
  file?: {
    path: string;
    version: string;
    changeType?: "created" | "modified";
    additions?: number;
    deletions?: number;
    replacements?: number;
  };
}): ToolOperationRecord {
  return {
    toolCallId: input.toolCallId.slice(0, 200),
    toolName: input.toolName.slice(0, 100),
    ok: input.ok,
    summary: clipLine(input.summary, 500),
    ...(input.argsSummary === undefined
      ? {}
      : { argsSummary: clipLine(input.argsSummary, MAX_OPERATION_ARGS_CHARS) }),
    ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode.slice(0, 100) }),
    ...(input.command === undefined
      ? {}
      : {
          command: {
            display: clipLine(input.command.display, MAX_OPERATION_ARGS_CHARS),
            exitCode: input.command.exitCode,
            ...(input.command.outputTail === undefined
              ? {}
              : { outputTail: clipTail(input.command.outputTail) }),
            ...(input.command.truncated === true ? { truncated: true } : {}),
          },
        }),
    ...(input.file === undefined
      ? {}
      : {
          file: {
            path: input.file.path.slice(0, 4_096),
            version: input.file.version,
            ...(input.file.changeType === undefined ? {} : { changeType: input.file.changeType }),
            ...(input.file.additions === undefined ? {} : { additions: input.file.additions }),
            ...(input.file.deletions === undefined ? {} : { deletions: input.file.deletions }),
            ...(input.file.replacements === undefined
              ? {}
              : { replacements: input.file.replacements }),
          },
        }),
  };
}

export function parseToolOperation(json: string): ToolOperationRecord | null {
  try {
    const parsed = operationSchema.safeParse(JSON.parse(json) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function renderOperation(operation: ToolOperationRecord): string {
  const label = operation.argsSummary ?? operation.command?.display;
  const head = `- ${operation.toolName}${label === undefined ? "" : `: ${label}`}`;
  const status = operation.ok
    ? "ok"
    : `failed${operation.errorCode === undefined ? "" : ` (${operation.errorCode})`}`;
  const details: string[] = [];

  if (operation.command !== undefined) {
    details.push(`exit ${operation.command.exitCode ?? "—"}`);

    if (operation.command.truncated === true) {
      details.push("truncated");
    }

    if (operation.command.outputTail !== undefined) {
      details.push(`tail: ${operation.command.outputTail}`);
    }
  }

  if (operation.file !== undefined) {
    details.push(`${operation.file.changeType ?? "changed"} ${operation.file.path}`);
    details.push(`version ${operation.file.version.slice(0, 12)}`);

    if (operation.file.additions !== undefined || operation.file.deletions !== undefined) {
      details.push(`+${operation.file.additions ?? 0} -${operation.file.deletions ?? 0}`);
    }

    if (operation.file.replacements !== undefined) {
      details.push(`${operation.file.replacements} replacement(s)`);
    }
  }

  if (!operation.ok && operation.summary.length > 0) {
    details.push(operation.summary);
  }

  return `${head} -> ${status}${details.length === 0 ? "" : `; ${details.join("; ")}`}`;
}

export interface OperationLog {
  text: string | null;
  count: number;
  omitted: number;
}

/**
 * Renders the newest previous-turn operations within a token budget. The
 * current Turn is excluded and rows covered by a session summary are skipped.
 */
export function operationLog(
  db: Database,
  sessionId: string,
  currentTurnId: string,
  coveredUpToSeq: number,
  budgetTokens = MAX_OPERATION_TOKENS,
): OperationLog {
  const rows = db
    .select()
    .from(agentEvents)
    .where(
      and(
        eq(agentEvents.sessionId, sessionId),
        eq(agentEvents.type, "tool.operation"),
        gt(agentEvents.seq, coveredUpToSeq),
      ),
    )
    .orderBy(desc(agentEvents.seq))
    .limit(MAX_OPERATIONS)
    .all();

  const records: ToolOperationRecord[] = [];

  for (const row of rows) {
    if (row.turnId === currentTurnId) {
      continue;
    }

    const operation = parseToolOperation(row.payloadJson);

    if (operation !== null) {
      records.push(operation);
    }
  }

  // Rows are newest-first; keep that order so a tight budget preserves the
  // most recent operation rather than the oldest.
  const selected: string[] = [];
  let spent = 0;

  for (const operation of records) {
    const line = renderOperation(operation);
    const tokens = estimateTextTokens(line) + 4;

    if (selected.length > 0 && spent + tokens > budgetTokens) {
      break;
    }

    selected.push(line);
    spent += tokens;
  }

  if (selected.length === 0) {
    return { text: null, count: 0, omitted: 0 };
  }

  const omitted = records.length - selected.length;
  const header =
    "Previous turn operations (system-recorded; may be stale; re-read files before patching):";
  const footer = omitted === 0 ? [] : [`- ... ${omitted} older operation(s) omitted`];

  return {
    text: [header, ...selected, ...footer].join("\n"),
    count: selected.length,
    omitted,
  };
}
