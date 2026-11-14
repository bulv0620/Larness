import { defineTool, type ToolDefinition } from "@larness/agent";
import {
  AcquireTerminalControlParamsSchema,
  InterruptTerminalParamsSchema,
  ReleaseTerminalControlParamsSchema,
  SendTerminalInputParamsSchema,
} from "@larness/shared";
import type { Database } from "../../db/client.js";
import type { SecretStore } from "../../security/secretStore.js";
import { listEncryptedSecrets } from "../models/repository.js";

function unavailable(summary: string) {
  return { ok: false as const, errorCode: "FORBIDDEN", summary };
}

export function createTerminalControlTools(options: {
  db: Database;
  secretStore?: SecretStore;
}): ToolDefinition[] {
  const inputSchema = SendTerminalInputParamsSchema.superRefine((args, context) => {
    const encrypted = listEncryptedSecrets(options.db);
    if (encrypted.length && !options.secretStore) {
      context.addIssue({ code: "custom", message: "Terminal input protection unavailable" });
      return;
    }
    if (
      encrypted.some((secret) => {
        const plaintext = options.secretStore?.decrypt(secret);
        return plaintext && args.data.includes(plaintext);
      })
    )
      context.addIssue({
        code: "custom",
        message: "Protected credentials cannot be typed into a terminal",
      });
  });

  return [
    defineTool({
      name: "acquire_terminal_control",
      description:
        "Acquire exclusive input control of an authorized workspace terminal (human Shell or agent dev) for the current Turn. Fails if a human or another Turn currently controls it; do not try to force a human takeover. Release control or end the Turn to hand it back.",
      riskLevel: "L1",
      requiresProjectLock: false,
      schema: AcquireTerminalControlParamsSchema,
      summarize: (args) => `获取终端 ${args.terminalId.slice(-6)} 控制权`,
      handler: async (args, context) =>
        context.acquireTerminalControl
          ? context.acquireTerminalControl(args)
          : unavailable("Terminal control context unavailable"),
    }),
    defineTool({
      name: "send_terminal_input",
      description:
        "Type bounded input into the controlled workspace terminal. Requires the current agent lease generation and the next input sequence. Read the prompt and use the active shell's syntax before sending shell commands. The input audit records metadata only. The shell or program may echo input into recorded terminal output. Never type credentials. Retries with the same sequence are not replayed. Use interrupt_terminal for Ctrl-C.",
      riskLevel: "L2",
      requiresProjectLock: false,
      schema: inputSchema,
      summarize: (args) =>
        `向终端 ${args.terminalId.slice(-6)} 发送 ${Buffer.byteLength(args.data)} 字节输入`,
      handler: async (args, context) =>
        context.sendTerminalInput
          ? context.sendTerminalInput(args)
          : unavailable("Terminal input context unavailable"),
    }),
    defineTool({
      name: "interrupt_terminal",
      description:
        "Send the terminal interrupt character (Ctrl-C / ETX) while holding the current lease. This only reports that the interrupt was sent, not that the process exited; read output and status afterwards.",
      riskLevel: "L2",
      requiresProjectLock: false,
      schema: InterruptTerminalParamsSchema,
      summarize: (args) => `向终端 ${args.terminalId.slice(-6)} 发送中断`,
      handler: async (args, context) =>
        context.interruptTerminal
          ? context.interruptTerminal(args)
          : unavailable("Terminal interrupt context unavailable"),
    }),
    defineTool({
      name: "release_terminal_control",
      description:
        "Release the current agent input lease. The terminal process keeps running; a human can take over afterwards.",
      riskLevel: "L1",
      requiresProjectLock: false,
      schema: ReleaseTerminalControlParamsSchema,
      summarize: (args) => `释放终端 ${args.terminalId.slice(-6)} 控制权`,
      handler: async (args, context) =>
        context.releaseTerminalControl
          ? context.releaseTerminalControl(args)
          : unavailable("Terminal release context unavailable"),
    }),
  ];
}
