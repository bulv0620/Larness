import { defineTool, type ToolDefinition, type ToolRiskLevel } from "@larness/agent";
import { NamedServiceIdSchema, StartServiceParamsSchema } from "@larness/shared";
import { z } from "zod";
import type { SecretStore } from "../../security/secretStore.js";
import { secretVerdict } from "./secretGuard.js";

function serviceRisk(input: unknown): ToolRiskLevel {
  const parsed = StartServiceParamsSchema.safeParse(input);
  if (!parsed.success) return "L2";
  const name = parsed.data.executable.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if (
    ["sudo", "su", "doas", "chmod", "chown", "useradd", "userdel", "dscl", "pfctl"].includes(name)
  ) {
    return "L3";
  }
  return "L2";
}

function repairServiceArgs(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const args = { ...(raw as Record<string, unknown>) };
  if (typeof args.executable !== "string") {
    for (const key of ["program", "command", "bin"] as const) {
      if (typeof args[key] === "string") {
        args.executable = args[key];
        break;
      }
    }
  }
  if (!Array.isArray(args.args) && Array.isArray(args.arguments)) args.args = args.arguments;
  if (typeof args.cwd !== "string" && typeof args.workdir === "string") args.cwd = args.workdir;
  for (const key of ["program", "command", "bin", "arguments", "workdir"]) delete args[key];
  args.args ??= [];
  return args;
}

const LogsSchema = z
  .object({
    serviceId: NamedServiceIdSchema,
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .strict();

const StopSchema = z.object({ serviceId: NamedServiceIdSchema }).strict();

export function createProcessServiceTools(options: {
  secretStore?: SecretStore;
}): ToolDefinition[] {
  return [
    {
      ...defineTool({
        name: "start_service",
        description:
          'Start a named background service in the project and bind it to a process, port and command summary. Use it for a dev server that should be listed, read and stopped as a service. Repeating the same project/name/command returns the running service; a different command with the same name is a conflict. The process group is stopped as a tree. Preview is not automatically enabled for process services. Example: {"name":"web","executable":"pnpm","args":["dev"],"cwd":".","port":5173}.',
        riskLevel: "L2",
        requiresProject: true,
        requiresProjectLock: false,
        schema: StartServiceParamsSchema,
        repairArgs: repairServiceArgs,
        summarize: (args) => `启动服务 ${args.name}（端口 ${args.port}）`,
        handler: async (args, context) => {
          if (!context.startService) {
            return {
              ok: false,
              errorCode: "FORBIDDEN",
              summary: "Service context unavailable",
            };
          }
          const verdict = secretVerdict(
            [args.executable, args.cwd, ...args.args],
            context.loadSecrets?.() ?? [],
            options.secretStore,
          );
          if (verdict === "unavailable") {
            return {
              ok: false,
              errorCode: "FORBIDDEN",
              summary: "Service protection unavailable",
            };
          }
          if (verdict === "blocked") {
            return {
              ok: false,
              errorCode: "FORBIDDEN",
              summary: "Protected credentials cannot be service arguments",
            };
          }
          return context.startService(args);
        },
      }),
      classifyRisk: serviceRisk,
    },
    defineTool({
      name: "read_service_logs",
      description:
        "Read bounded new logs from a named process service. Use the returned nextCursor as the next after value; resyncRequired means older chunks were dropped. RUNNING is not an HTTP health proof.",
      riskLevel: "L0",
      requiresProject: true,
      requiresProjectLock: false,
      schema: LogsSchema,
      summarize: (args) => `读取服务日志 ${args.serviceId.slice(-6)}`,
      handler: async (args, context) =>
        context.readServiceLogs
          ? context.readServiceLogs(args)
          : { ok: false, errorCode: "FORBIDDEN", summary: "Service context unavailable" },
    }),
    defineTool({
      name: "stop_service",
      description:
        "Stop a named process service and its process group. Stopping an already stopped service is idempotent; a stop that cannot be confirmed returns STOP_UNCONFIRMED instead of a false success.",
      riskLevel: "L1",
      requiresProject: true,
      requiresProjectLock: false,
      schema: StopSchema,
      summarize: (args) => `停止服务 ${args.serviceId.slice(-6)}`,
      handler: async (args, context) =>
        context.stopService
          ? context.stopService(args)
          : { ok: false, errorCode: "FORBIDDEN", summary: "Service context unavailable" },
    }),
  ];
}
