import { defineTool, type ToolDefinition } from "@larness/agent";
import { ServiceRegisterInputSchema } from "@larness/shared";
import { z } from "zod";

const ListSchema = z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict();

export function createServiceTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "register_temporary_service",
      description:
        "Register an already running HTTP service started inside a project terminal. The backend verifies that the listener really belongs to that terminal and is bound to loopback; it never spawns, restarts or adopts the process. Use the terminal port, not a URL. RUNNING means the listener identity was verified, not that the business endpoint is healthy. Re-registering the same live endpoint is idempotent; a restarted process needs a new registration.",
      riskLevel: "L2",
      requiresProjectLock: false,
      schema: ServiceRegisterInputSchema,
      summarize: (args) =>
        `登记临时服务 ${args.name}（${args.endpoint.host}:${args.endpoint.port}）`,
      handler: async (args, context) =>
        context.registerService
          ? context.registerService(args)
          : { ok: false, errorCode: "FORBIDDEN", summary: "Service context unavailable" },
    }),
    defineTool({
      name: "list_services",
      description:
        "List temporary services registered for the current project with their verified status and endpoints. Read-only; ended services are not returned by default.",
      riskLevel: "L0",
      requiresProjectLock: false,
      schema: ListSchema,
      summarize: () => "列出项目服务",
      handler: async (args, context) =>
        context.listServices
          ? context.listServices(args)
          : { ok: false, errorCode: "FORBIDDEN", summary: "Service context unavailable" },
    }),
  ];
}
