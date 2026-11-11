import type { z } from "zod";

export type ToolRiskLevel = "L0" | "L1" | "L2" | "L3";

export type ApprovalPolicy = "standard" | "strict" | "readonly" | "autonomous";

export type ToolAccessDecision = "allow" | "require_approval" | "deny";

/** Structural form of an encrypted credential row; decryption stays in the server. */
export interface EncryptedSecretRef {
  ciphertext: string;
  nonce: string;
  tag: string;
}

export interface ToolContext {
  projectRoot: string;
  ignore?: string[];
  signal?: AbortSignal;
  updatePlan?: (args: unknown) => Promise<ToolResult>;
  runCommand?: (args: unknown) => Promise<ToolResult>;
  startTerminal?: (args: unknown) => Promise<ToolResult>;
  readTerminalOutput?: (args: unknown) => Promise<ToolResult>;
  stopTerminal?: (args: unknown) => Promise<ToolResult>;
  acquireTerminalControl?: (args: unknown) => Promise<ToolResult>;
  sendTerminalInput?: (args: unknown) => Promise<ToolResult>;
  interruptTerminal?: (args: unknown) => Promise<ToolResult>;
  releaseTerminalControl?: (args: unknown) => Promise<ToolResult>;
  gitRead?: (
    operation: "status" | "diff" | "log" | "branches",
    args: unknown,
  ) => Promise<ToolResult>;
  gitAction?: (args: unknown) => Promise<ToolResult>;
  registerService?: (args: unknown) => Promise<ToolResult>;
  listServices?: (args: unknown) => Promise<ToolResult>;
  resolveServicePreview?: (args: unknown) => Promise<ToolResult>;
  refreshObservations?: () => Promise<ToolResult>;
  /** Per-Turn cached secret rows; callers must not cache plaintext. */
  loadSecrets?: () => EncryptedSecretRef[];
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  data?: unknown;
  errorCode?: string;
  truncated?: boolean;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly riskLevel: ToolRiskLevel;
  readonly schema: z.ZodType;
  readonly classifyRisk?: (args: unknown) => ToolRiskLevel;
  readonly summarize?: (args: unknown) => string;
  /** Offer this tool to the model only in a registered project. */
  readonly requiresProject?: boolean;
  /** Source writes need the shared project lock; read/process tools can opt out. */
  readonly requiresProjectLock?: boolean;
  execute(rawArgs: unknown, context: ToolContext): Promise<ToolResult>;
}

export interface ToolDefinitionInput<Schema extends z.ZodType> {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  schema: Schema;
  summarize?: (args: z.infer<Schema>) => string;
  requiresProject?: boolean;
  requiresProjectLock?: boolean;
  handler: (args: z.infer<Schema>, context: ToolContext) => Promise<ToolResult>;
}

export function defineTool<Schema extends z.ZodType>(
  input: ToolDefinitionInput<Schema>,
): ToolDefinition {
  return {
    name: input.name,
    description: input.description,
    riskLevel: input.riskLevel,
    schema: input.schema,
    requiresProject: input.requiresProject ?? false,
    requiresProjectLock: input.requiresProjectLock ?? true,
    ...(input.summarize === undefined
      ? {}
      : { summarize: (args: unknown) => input.summarize?.(args as z.infer<Schema>) ?? "" }),
    async execute(rawArgs: unknown, context: ToolContext): Promise<ToolResult> {
      const parsed = input.schema.safeParse(rawArgs);

      if (!parsed.success) {
        return {
          ok: false,
          errorCode: "VALIDATION_ERROR",
          summary: "invalid tool arguments",
          data: {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          },
        };
      }

      return input.handler(parsed.data as z.infer<Schema>, context);
    },
  };
}

export function decideToolAccess(
  policy: ApprovalPolicy,
  riskLevel: ToolRiskLevel,
): ToolAccessDecision {
  if (policy === "autonomous") return "allow";
  if (riskLevel === "L3") return "deny";
  if (riskLevel === "L0") {
    return "allow";
  }

  if (policy === "readonly") {
    return "deny";
  }

  if (policy === "strict") {
    return "require_approval";
  }

  return riskLevel === "L2" ? "require_approval" : "allow";
}

export function truncateToolText(
  text: string,
  maxBytes = 1_048_576,
  maxLines = 2_000,
): { text: string; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  let truncated = false;

  if (lines.length > maxLines) {
    truncated = true;
  }

  const joined = lines.slice(0, maxLines).join("\n");
  const buffer = Buffer.from(joined, "utf8");

  if (buffer.length <= maxBytes) {
    return { text: joined, truncated };
  }

  return {
    text: buffer.subarray(0, maxBytes).toString("utf8"),
    truncated: true,
  };
}
