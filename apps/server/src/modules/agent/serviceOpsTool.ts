import { defineTool, type ToolDefinition } from "@larness/agent";
import { DeploymentTargetIdSchema } from "@larness/shared";
import { z } from "zod";

const ListSchema = z.object({}).strict();
const LogsSchema = z.object({ targetId: DeploymentTargetIdSchema }).strict();
const ControlSchema = z
  .object({
    targetId: DeploymentTargetIdSchema,
    action: z.enum(["start", "stop", "restart"]),
  })
  .strict();

export function createServiceOpsTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "list_service_ops",
      description:
        "List existing Larness-managed PM2 services and their project associations. This tool does not create deployment targets, build artifacts or files; an empty list means there is no target yet, not that PM2 is unavailable. Deploy from a project coding session first.",
      riskLevel: "L0",
      requiresProject: false,
      requiresProjectLock: false,
      prefetchable: true,
      schema: ListSchema,
      summarize: () => "列出全局 PM2 服务",
      handler: async (_args, context) =>
        context.listServiceOps
          ? context.listServiceOps()
          : {
              ok: false,
              errorCode: "FORBIDDEN",
              summary: "Service operations context unavailable",
            },
    }),
    defineTool({
      name: "read_service_ops_logs",
      description:
        "Read the bounded tail of a Larness-managed PM2 service log. Identity is the targetId plus the current pm2Name; logs are redacted by the backend and truncated to 1 MiB.",
      riskLevel: "L0",
      requiresProject: false,
      requiresProjectLock: false,
      prefetchable: true,
      schema: LogsSchema,
      summarize: (args) => `读取 PM2 服务日志 ${args.targetId.slice(-6)}`,
      handler: async (args, context) =>
        context.readServiceOpsLogs
          ? context.readServiceOpsLogs(args)
          : {
              ok: false,
              errorCode: "FORBIDDEN",
              summary: "Service operations context unavailable",
            },
    }),
    defineTool({
      name: "control_service_ops",
      description:
        "Start, stop or restart one existing Larness-managed PM2 service by targetId. The backend re-checks the current pm2Name, takes project and service leases, and persists the control operation; a stale target returns DEPLOY_CONFLICT instead of touching another process. This tool cannot build or create a deployment target.",
      riskLevel: "L2",
      requiresProject: false,
      requiresProjectLock: false,
      schema: ControlSchema,
      summarize: (args) => `服务运维 ${args.action} ${args.targetId.slice(-6)}`,
      handler: async (args, context) =>
        context.controlServiceOps
          ? context.controlServiceOps(args)
          : {
              ok: false,
              errorCode: "FORBIDDEN",
              summary: "Service operations context unavailable",
            },
    }),
  ];
}
