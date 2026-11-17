import { defineTool, type ToolDefinition } from "@larness/agent";
import { ServiceIdSchema, ServiceRegisterInputSchema } from "@larness/shared";
import { z } from "zod";

const ListSchema = z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict();

export function createServiceTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "register_temporary_service",
      description:
        "Register an already running temporary HTTP service for a listener inside a managed project terminal, not PM2. This only records listener and preview metadata: it does not start, daemonize, deploy or convert a service. The backend verifies that the live listener at the supplied port belongs to that terminal. A wildcard listener such as 0.0.0.0 or :: can be registered without restarting or rebinding it. Registering the same live endpoint and name again is idempotent; a restarted process needs a new registration. Verify HTTP health separately.",
      riskLevel: "L2",
      requiresProject: true,
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
      name: "resolve_service_preview",
      description:
        "Resolve a structured preview target for an active temporary svc_ service in this project, not a PM2 targetId or pm2Name. Read-only intent: it issues no ticket and starts nothing; the user opens the preview from the card, where the backend re-authorizes and issues a short-lived ticket for the isolated preview origin.",
      riskLevel: "L0",
      requiresProject: true,
      requiresProjectLock: false,
      schema: z
        .object({
          serviceId: ServiceIdSchema,
          path: z.string().min(1).max(2048).default("/"),
        })
        .strict(),
      summarize: (args) => `解析预览 ${args.serviceId.slice(-6)}${args.path}`,
      handler: async (args, context) =>
        context.resolveServicePreview
          ? context.resolveServicePreview(args)
          : { ok: false, errorCode: "FORBIDDEN", summary: "Service context unavailable" },
    }),
    defineTool({
      name: "list_services",
      description:
        "List only this project's temporary terminal services with their observed status and endpoints; persistent PM2 services arrive in the runtime observations instead. Read-only, and ended services are omitted by default.",
      riskLevel: "L0",
      requiresProject: true,
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
