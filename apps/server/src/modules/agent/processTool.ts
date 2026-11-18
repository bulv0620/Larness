import { defineTool, type ToolDefinition, type ToolRiskLevel } from "@larness/agent";
import { ProcessIdSchema, StartProcessParamsSchema } from "@larness/shared";
import { z } from "zod";
import type { SecretStore } from "../../security/secretStore.js";
import { secretVerdict } from "./secretGuard.js";

function processRisk(input: unknown): ToolRiskLevel {
  const parsed = StartProcessParamsSchema.safeParse(input);
  if (!parsed.success) return "L2";
  const name = parsed.data.executable.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if (
    ["sudo", "su", "doas", "chmod", "chown", "useradd", "userdel", "dscl", "pfctl"].includes(name)
  ) {
    return "L3";
  }
  return "L2";
}

function repairStartProcessArgs(raw: unknown): unknown {
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

const ListSchema = z.object({ limit: z.number().int().min(1).max(200).default(100) }).strict();

const ReadOutputSchema = z
  .object({
    processId: ProcessIdSchema,
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    limit: z.number().int().min(1).max(500).default(100),
  })
  .strict();

const StopSchema = z.object({ processId: ProcessIdSchema }).strict();

export function createProcessTools(options: { secretStore?: SecretStore }): ToolDefinition[] {
  return [
    {
      ...defineTool({
        name: "start_process",
        description:
          'Start a non-interactive background process in the project and return a stable processId, cwd and output cursor. Use it for long-running dev servers or watchers that should outlive the current tool call; use run_command for finite builds and tests. Declare port when the task listens on a local HTTP port so the project service window can offer a manual preview; healthPath is optional. The process group is stopped as a tree when stop_process is called. Repeating the same Turn/tool call returns the existing process; the same name with different executable, args, cwd, port or healthPath is a conflict. The process runs with the Larness OS account\'s permissions. Example: {"executable":"pnpm","args":["dev"],"cwd":".","name":"web","port":5173}.',
        riskLevel: "L2",
        requiresProject: true,
        requiresProjectLock: false,
        schema: StartProcessParamsSchema,
        repairArgs: repairStartProcessArgs,
        summarize: (args) => `启动后台进程 ${args.name ?? args.executable}`,
        handler: async (args, context) => {
          if (!context.startProcess) {
            return {
              ok: false,
              errorCode: "FORBIDDEN",
              summary: "Process context unavailable",
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
              summary: "Process protection unavailable",
            };
          }
          if (verdict === "blocked") {
            return {
              ok: false,
              errorCode: "FORBIDDEN",
              summary: "Protected credentials cannot be process arguments",
            };
          }
          return context.startProcess(args);
        },
      }),
      classifyRisk: processRisk,
    },
    defineTool({
      name: "list_processes",
      description:
        "List active background processes started by this project. Ended tasks are removed from the list; use the processId from start_process or read_process_output for a specific task. previewEligible is true only for a RUNNING task with a declared port.",
      riskLevel: "L0",
      requiresProject: true,
      requiresProjectLock: false,
      schema: ListSchema,
      summarize: () => "列出项目后台任务",
      handler: async (args, context) =>
        context.listProcesses
          ? context.listProcesses(args)
          : { ok: false, errorCode: "FORBIDDEN", summary: "Process context unavailable" },
    }),
    defineTool({
      name: "read_process_output",
      description:
        "Read bounded new output from a background process started in this project. Use the returned nextCursor as the next after value; resyncRequired means older chunks were dropped and the cursor should restart from oldestCursor. RUNNING means the process is alive, not that its service is healthy.",
      riskLevel: "L0",
      requiresProject: true,
      requiresProjectLock: false,
      schema: ReadOutputSchema,
      summarize: (args) => `读取进程输出 ${args.processId.slice(-6)}`,
      handler: async (args, context) =>
        context.readProcessOutput
          ? context.readProcessOutput(args)
          : { ok: false, errorCode: "FORBIDDEN", summary: "Process context unavailable" },
    }),
    defineTool({
      name: "stop_process",
      description:
        "Stop a background process group started in this project. Stopping an already stopped process is idempotent. The backend tries a graceful stop, then forces the process tree; a failure is reported as STOP_UNCONFIRMED instead of a false success.",
      riskLevel: "L1",
      requiresProject: true,
      requiresProjectLock: false,
      schema: StopSchema,
      summarize: (args) => `停止进程 ${args.processId.slice(-6)}`,
      handler: async (args, context) =>
        context.stopProcess
          ? context.stopProcess(args)
          : { ok: false, errorCode: "FORBIDDEN", summary: "Process context unavailable" },
    }),
  ];
}
