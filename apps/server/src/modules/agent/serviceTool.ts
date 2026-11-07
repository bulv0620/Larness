import { defineTool, type ToolDefinition } from "@larness/agent";
import { ServiceIdSchema, ServiceRegisterInputSchema } from "@larness/shared";
import { z } from "zod";

const ListSchema = z.object({ limit: z.number().int().min(1).max(200).default(50) }).strict();

export function createServiceTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "register_temporary_service",
      description:
        "Register an already running temporary HTTP service inside a managed project terminal, not PM2. This only registers listener/preview metadata; it does not start, daemonize, deploy, or convert a service. The backend verifies the actual listener's ownership at the supplied port. Wildcard listeners such as 0.0.0.0 and :: can be registered without rebinding or restarting. Supply the port and a loopback endpoint.host value (127.0.0.1 or ::1). The backend discovers the actual bind address. RUNNING confirms listener identity. Verify HTTP health separately. Re-registering the same live endpoint and name is idempotent. A restarted process needs a new registration.",
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
        "Resolve a structured preview target for an active temporary svc_ service in the current project, not a PM2 targetId or pm2Name. This is a read-only intent: it issues no ticket and starts nothing. The user opens the preview from the card, where the backend re-authorizes and issues a short-lived ticket for the isolated preview origin.",
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
        "List only temporary terminal services registered for the current project with their observed status and endpoints. Persistent PM2 services are supplied separately in system context and are managed with run_command. Read-only; ended services are not returned by default.",
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
