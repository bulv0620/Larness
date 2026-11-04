import { defineTool, type ToolDefinition } from "@larness/agent";
import {
  ReadTerminalOutputParamsSchema,
  StopProjectTerminalParamsSchema,
  TerminalDevSchema,
} from "@larness/shared";
import type { Database } from "../../db/client.js";
import type { SecretStore } from "../../security/secretStore.js";
import { listEncryptedSecrets } from "../models/repository.js";

function unavailable(summary: string) {
  return { ok: false as const, errorCode: "FORBIDDEN", summary };
}

export function createTerminalTools(options: {
  db: Database;
  secretStore?: SecretStore;
}): ToolDefinition[] {
  const startSchema = TerminalDevSchema.superRefine((args, context) => {
    const encrypted = listEncryptedSecrets(options.db);
    if (encrypted.length && !options.secretStore) {
      context.addIssue({ code: "custom", message: "Terminal protection unavailable" });
      return;
    }
    const values = [args.executable, args.role, args.cwd, ...args.args];
    if (
      encrypted.some((secret) => {
        const plaintext = options.secretStore?.decrypt(secret);
        return plaintext && values.some((value) => value.includes(plaintext));
      })
    ) {
      context.addIssue({
        code: "custom",
        message: "Protected credentials cannot be terminal arguments",
      });
    }
  });

  return [
    defineTool({
      name: "start_project_terminal",
      description:
        "Start a persistent project dev process (for example pnpm dev) as a real PTY. Use a stable role such as frontend or backend; an active role with different parameters is a conflict. Requires per-call approval. Use run_command for finite tests/builds. The project directory is not a sandbox and the process may write files concurrently.",
      riskLevel: "L2",
      requiresProjectLock: false,
      schema: startSchema,
      summarize: (args) => `启动项目终端 ${args.role}（项目目录不是沙箱；dev 进程可能并发写源码）`,
      handler: async (args, context) =>
        context.startTerminal
          ? context.startTerminal(args)
          : unavailable("Terminal execution context unavailable"),
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
        "Explicitly stop a dev terminal created by the agent in the current project. Waits for confirmed exit and does not stop human shell terminals. Stopping a Turn does not call this tool.",
      riskLevel: "L1",
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
