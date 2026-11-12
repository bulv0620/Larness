import { defineTool, type ToolDefinition } from "@larness/agent";
import {
  ReadTerminalOutputParamsSchema,
  StopProjectTerminalParamsSchema,
  TerminalDevSchema,
} from "@larness/shared";
import type { Database } from "../../db/client.js";
import type { SecretStore } from "../../security/secretStore.js";
import { secretVerdict } from "./secretGuard.js";

function unavailable(summary: string) {
  return { ok: false as const, errorCode: "FORBIDDEN", summary };
}

export function createTerminalTools(options: {
  db: Database;
  secretStore?: SecretStore;
}): ToolDefinition[] {
  return [
    defineTool({
      name: "start_project_terminal",
      description:
        "Create a managed project terminal and run a temporary dev program in the foreground. The PTY stays usable between commands, but this is not persistent PM2 deployment. For HTTP previews, register the verified listener with register_temporary_service; stopping Larness ends temporary resources. Inspect the project's scripts and use its declared entry point. Set project-relative cwd to the package directory when invoking a package command directly. The default cwd is the project root. Follow the current Turn's approval policy. Ctrl+C or program exit returns to an interactive shell in the same PTY. RUNNING confirms the terminal is alive. Inspect output for the listening port and verify service readiness separately. Reusing a role returns the terminal without rerunning the program. To restart from its idle shell, acquire the input lease and send the project's dev command. An active role with different parameters is a conflict. Use run_command for finite tests/builds. The process runs with host account permissions and may write files concurrently.",
      riskLevel: "L2",
      requiresProject: true,
      requiresProjectLock: false,
      schema: TerminalDevSchema,
      summarize: (args) =>
        `启动项目终端 ${args.role}（以本机账户权限运行，可访问项目外文件。dev 进程可能并发写源码）`,
      handler: async (args, context) => {
        if (!context.startTerminal) {
          return unavailable("Terminal execution context unavailable");
        }

        const verdict = secretVerdict(
          [args.executable, args.role, args.cwd, ...args.args],
          context.loadSecrets?.() ?? [],
          options.secretStore,
        );

        if (verdict === "unavailable") {
          return unavailable("Terminal protection unavailable");
        }

        if (verdict === "blocked") {
          return unavailable("Protected credentials cannot be terminal arguments");
        }

        return context.startTerminal(args);
      },
    }),
    defineTool({
      name: "read_terminal_output",
      description:
        "Read bounded, redacted cursor output from an authorized Shell or dev terminal in the current workspace. Does not take input control. Pass the returned nextCursor as after to read later output.",
      riskLevel: "L0",
      requiresProjectLock: false,
      schema: ReadTerminalOutputParamsSchema,
      summarize: (args) => `读取终端 ${args.terminalId.slice(-6)} 输出`,
      handler: async (args, context) =>
        context.readTerminalOutput
          ? context.readTerminalOutput(args)
          : unavailable("Terminal read context unavailable"),
    }),
    defineTool({
      name: "stop_project_terminal",
      description:
        "Close the entire dev terminal created by the agent in the current project, including its shell and managed descendants. Use interrupt_terminal to stop only the foreground command and keep the terminal usable. Waits for confirmed exit and does not stop human shell terminals. Stopping a Turn does not call this tool.",
      riskLevel: "L1",
      requiresProject: true,
      requiresProjectLock: false,
      schema: StopProjectTerminalParamsSchema,
      summarize: (args) => `停止项目终端 ${args.terminalId.slice(-6)}`,
      handler: async (args, context) =>
        context.stopTerminal
          ? context.stopTerminal(args)
          : unavailable("Terminal stop context unavailable"),
    }),
  ];
}
