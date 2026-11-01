import type { z } from "zod";

export type ToolRiskLevel = "L0" | "L1" | "L2";

export type ApprovalPolicy = "standard" | "strict" | "readonly";

export type ToolAccessDecision = "allow" | "require_approval" | "deny";

export interface ToolContext {
  projectRoot: string;
  ignore?: string[];
  signal?: AbortSignal;
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
  readonly summarize?: (args: unknown) => string;
  execute(rawArgs: unknown, context: ToolContext): Promise<ToolResult>;
}

export interface ToolDefinitionInput<Schema extends z.ZodType> {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  schema: Schema;
  summarize?: (args: z.infer<Schema>) => string;
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
