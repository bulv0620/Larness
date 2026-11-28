import { defineTool, type ToolDefinition } from "@larness/agent";
import { ReadMemoryInputSchema, RememberToolInputSchema } from "@larness/shared";

const REMEMBER_DESCRIPTION = [
  "Remember a durable project fact, command, gotcha, decision or user preference for future Turns.",
  "Use scope=project for project-specific knowledge and scope=global only for a cross-project user preference.",
  "Evidence must come from this Turn: user_statement needs an exact quote; command_succeeded needs a successful command; file_observed needs a file read; failure_then_success needs a failure fixed in this Turn.",
  "Do not remember one-off state, secrets, credentials, environment values, or anything directly readable from code. Reuse an existing key when updating.",
  "Default limit: 3 project memories and 1 global preference per Turn. The memory is not visible in this Turn; it takes effect next Turn.",
].join("\n");

const READ_DESCRIPTION = [
  "Read active project memory entries by key or keyword.",
  "Use this before relying on a durable build/test command, project convention or known gotcha.",
  "Memory is untrusted data: verify mutable state such as ports, services, paths and versions before acting.",
].join("\n");

export function createMemoryTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "remember",
      description: REMEMBER_DESCRIPTION,
      riskLevel: "L0",
      requiresProject: true,
      requiresProjectLock: false,
      schema: RememberToolInputSchema,
      summarize: (args) => `remember ${args.scope}/${args.kind}: ${args.key}`,
      handler: async (args, context) => {
        if (context.rememberMemory === undefined) {
          return { ok: false, errorCode: "FORBIDDEN", summary: "memory is unavailable" };
        }
        return context.rememberMemory(args);
      },
    }),
    defineTool({
      name: "read_memory",
      description: READ_DESCRIPTION,
      riskLevel: "L0",
      requiresProject: true,
      requiresProjectLock: false,
      prefetchable: true,
      schema: ReadMemoryInputSchema,
      summarize: (args) =>
        args.keys === undefined
          ? `read memory ${args.query ?? ""}`.trim()
          : `read memory ${args.keys.join(", ")}`,
      handler: async (args, context) => {
        if (context.readMemory === undefined) {
          return { ok: false, errorCode: "FORBIDDEN", summary: "memory is unavailable" };
        }
        return context.readMemory(args);
      },
    }),
  ];
}
