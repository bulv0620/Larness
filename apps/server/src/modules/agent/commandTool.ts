import { defineTool, type ToolDefinition, type ToolRiskLevel } from "@larness/agent";
import { CommandParamsSchema } from "@larness/shared";
import type { SecretStore } from "../../security/secretStore.js";

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
type SecretVerdict = "ok" | "blocked" | "unavailable";

/**
 * Credentials must never appear in command arguments. The secret rows are read
 * once per Turn by the runner (D8); this check still decrypts on every call and
 * never caches plaintext.
 */
export function commandSecretVerdict(
  values: string[],
  secrets: { ciphertext: string; nonce: string; tag: string }[],
  secretStore: SecretStore | undefined,
): SecretVerdict {
  if (secrets.length === 0) {
    return "ok";
  }

  if (secretStore === undefined) {
    return "unavailable";
  }

  const blocked = secrets.some((secret) => {
    const plaintext = secretStore.decrypt(secret);
    return plaintext.length > 0 && values.some((value) => value.includes(plaintext));
  });

  return blocked ? "blocked" : "ok";
}

export function createCommandTool(options: { secretStore?: SecretStore }): ToolDefinition {
  return {
    ...defineTool({
      name: "run_command",
      description:
        "Run a finite noninteractive command with executable and argument array. No shell interpolation or env field. Project scripts run on the host with the Larness OS account's permissions and can access files outside the project. Use this for tests/build/lint and finite PM2 CLI commands for persistent formal services. The backend supplies the PM2_HOME and PM2 path shown in system context. Use the exact project-qualified PM2 name. Use bounded logs with --nostream. An exit code of zero does not prove application health. Interactive development servers belong in project terminals.",
      riskLevel: "L2",
      schema: CommandParamsSchema,
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
