import { defineTool, type ToolDefinition, type ToolRiskLevel } from "@larness/agent";
import { CommandParamsSchema, ShellCommandParamsSchema } from "@larness/shared";
import type { SecretStore } from "../../security/secretStore.js";
import { secretVerdict } from "./secretGuard.js";

// Classification changes approval only. Project scripts still execute host code.
export function commandRisk(input: unknown): ToolRiskLevel {
  const parsed = CommandParamsSchema.safeParse(input);
  if (!parsed.success) return "L2";
  const { executable, args } = parsed.data;
  const name = executable.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
  if (
    ["sudo", "su", "doas", "chmod", "chown", "useradd", "userdel", "dscl", "pfctl"].includes(name)
  )
    return "L3";
  if (["npm", "pnpm", "yarn"].includes(executable)) {
    const script = args[0] === "run" ? args.slice(1) : args;
    if (script.length === 1 && ["test", "build", "lint"].includes(script[0])) return "L1";
  }
  return "L2";
}
export const commandSecretVerdict = secretVerdict;

/**
 * Normalize the field aliases models use for structured commands. The schema
 * stays strict; only known aliases are moved and removed.
 */
function repairCommandArgs(raw: unknown): unknown {
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
  if (!Array.isArray(args.args) && Array.isArray(args.arguments)) {
    args.args = args.arguments;
  }
  if (typeof args.cwd !== "string" && typeof args.workdir === "string") {
    args.cwd = args.workdir;
  }
  if (typeof args.timeoutMs !== "number" && typeof args.timeout === "number") {
    args.timeoutMs = args.timeout;
  }
  for (const key of ["program", "command", "bin", "arguments", "workdir", "timeout"]) {
    delete args[key];
  }
  args.args ??= [];
  return args;
}

function repairShellArgs(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const args = { ...(raw as Record<string, unknown>) };

  if (typeof args.command !== "string") {
    for (const key of ["cmd", "script"] as const) {
      if (typeof args[key] === "string") {
        args.command = args[key];
        break;
      }
    }
  }
  if (Array.isArray(args.command)) args.command = args.command.map(String).join(" ");
  if (typeof args.cwd !== "string" && typeof args.workdir === "string") {
    args.cwd = args.workdir;
  }
  if (typeof args.timeoutMs !== "number" && typeof args.timeout === "number") {
    args.timeoutMs = args.timeout;
  }
  for (const key of ["cmd", "script", "workdir", "timeout"]) delete args[key];
  return args;
}

function firstShellToken(command: string): string {
  return (command.trim().split(/\s+/, 1)[0] ?? "")
    .toLowerCase()
    .replace(/^["']|["']$/g, "")
    .replace(/\.exe$/, "");
}

function shellRisk(input: unknown): ToolRiskLevel {
  const parsed = ShellCommandParamsSchema.safeParse(input);
  if (!parsed.success) return "L2";
  const name = firstShellToken(parsed.data.command);
  if (
    ["sudo", "su", "doas", "chmod", "chown", "useradd", "userdel", "dscl", "pfctl"].includes(name)
  ) {
    return "L3";
  }
  return "L2";
}

export function createCommandTool(options: { secretStore?: SecretStore }): ToolDefinition {
  return {
    ...defineTool({
      name: "run_command",
      description:
        'Run a finite noninteractive command. The argument object is strict: send only executable, args, cwd and timeoutMs — never a shell string, env or other fields. `args` defaults to []. `cwd` is project-relative ("." is the project root); absolute paths are rejected. `timeoutMs` defaults to 300000 and may be raised to 1800000 for installs, builds and full test suites; the backend clamps it to the time left in the Turn. Project scripts run on the host with the Larness OS account\'s permissions and can reach files outside the project. Use it for tests, builds, lint and finite PM2 CLI commands: PM2_HOME and the PM2 path arrive in system context, the project-qualified name must be exact, and logs stay bounded with --nostream. Exit code 0 does not prove application health. Interactive TUI commands are rejected; use non-interactive arguments. Example: {"executable":"pnpm","args":["-r","test"],"cwd":"."}.',
      riskLevel: "L2",
      schema: CommandParamsSchema,
      repairArgs: repairCommandArgs,
      summarize: () => "运行命令（以本机账户权限运行，可访问项目外文件）",
      handler: async (args, context) => {
        if (!context.runCommand) {
          return {
            ok: false,
            errorCode: "FORBIDDEN",
            summary: "Command execution context unavailable",
          };
        }

        const values = [args.executable, args.cwd, ...args.args];
        const verdict = commandSecretVerdict(
          values,
          context.loadSecrets?.() ?? [],
          options.secretStore,
        );

        if (verdict === "unavailable") {
          return {
            ok: false,
            errorCode: "FORBIDDEN",
            summary: "Command protection unavailable",
          };
        }

        if (verdict === "blocked") {
          return {
            ok: false,
            errorCode: "FORBIDDEN",
            summary: "Protected credentials cannot be command arguments",
          };
        }

        return context.runCommand(args);
      },
    }),
    classifyRisk: commandRisk,
  };
}

export function createShellTool(options: { secretStore?: SecretStore }): ToolDefinition {
  return {
    ...defineTool({
      name: "run_shell",
      description:
        'Run a finite noninteractive command through the platform shell. Use only when you need a pipe, redirection, wildcard or platform-specific shell syntax; prefer run_command with executable + args for builds, tests, Git and PM2. POSIX uses /bin/sh -c; Windows prefers PowerShell 7, then Windows PowerShell 5.1, then cmd. Do not assume bash; do not translate syntax between platforms. The result names the actual shell and separates stdout from stderr. Interactive TUI commands are rejected; use non-interactive arguments. The command runs on the host with the Larness OS account\'s permissions and can reach files outside the project. Example: {"command":"pnpm test 2>&1 | tail -n 40","cwd":"."}.',
      riskLevel: "L2",
      schema: ShellCommandParamsSchema,
      repairArgs: repairShellArgs,
      summarize: (args) => `通过 shell 运行：${args.command.slice(0, 120)}`,
      handler: async (args, context) => {
        if (!context.runCommand) {
          return {
            ok: false,
            errorCode: "FORBIDDEN",
            summary: "Command execution context unavailable",
          };
        }

        const verdict = commandSecretVerdict(
          [args.command, args.cwd],
          context.loadSecrets?.() ?? [],
          options.secretStore,
        );

        if (verdict === "unavailable") {
          return {
            ok: false,
            errorCode: "FORBIDDEN",
            summary: "Command protection unavailable",
          };
        }

        if (verdict === "blocked") {
          return {
            ok: false,
            errorCode: "FORBIDDEN",
            summary: "Protected credentials cannot be command arguments",
          };
        }

        return context.runCommand(args);
      },
    }),
    classifyRisk: shellRisk,
  };
}
