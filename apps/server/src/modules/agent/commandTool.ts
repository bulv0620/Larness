import { defineTool, type ToolDefinition, type ToolRiskLevel } from "@larness/agent";
import { CommandParamsSchema } from "@larness/shared";
import type { Database } from "../../db/client.js";
import type { SecretStore } from "../../security/secretStore.js";
import { listEncryptedSecrets } from "../models/repository.js";

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
export function createCommandTool(options: {
  db: Database;
  secretStore?: SecretStore;
}): ToolDefinition {
  const schema = CommandParamsSchema.superRefine((args, context) => {
    const encrypted = listEncryptedSecrets(options.db);
    if (encrypted.length && !options.secretStore) {
      context.addIssue({ code: "custom", message: "Command protection unavailable" });
      return;
    }
    const values = [args.executable, args.cwd, ...args.args];
    if (
      encrypted.some((secret) => {
        const plaintext = options.secretStore?.decrypt(secret);
        return plaintext && values.some((value) => value.includes(plaintext));
      })
    ) {
      context.addIssue({
        code: "custom",
        message: "Protected credentials cannot be command arguments",
      });
    }
  });
  return {
    ...defineTool({
      name: "run_command",
      description:
        "Run a finite noninteractive command with executable and argument array. No shell interpolation or env field. Project scripts execute as the Larness OS account; the project directory is not a sandbox. Use this for tests/build/lint, not persistent dev servers.",
      riskLevel: "L2",
      schema,
      summarize: () => "运行命令（以 Larness 系统账户执行，项目目录不是沙箱）",
      handler: async (args, context) =>
        context.runCommand
          ? context.runCommand(args)
          : { ok: false, errorCode: "FORBIDDEN", summary: "Command execution context unavailable" },
    }),
    classifyRisk: commandRisk,
  };
}
