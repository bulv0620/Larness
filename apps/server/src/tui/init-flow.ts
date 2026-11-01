import type { InitResult } from "../init/service.js";
import type { InitApplyParams } from "../ipc/protocol.js";
import { buildInitRequest, type InitWizardAnswers } from "./init-wizard.js";

export interface InitPrompts {
  password(): Promise<string>;
  confirmPassword(): Promise<string>;
  host(): Promise<string>;
  port(): Promise<string>;
  publicUrl(): Promise<string>;
  channel(): Promise<"stable" | "beta">;
  confirm(summary: string): Promise<boolean>;
  notify?(message: string): void;
}

export type InitApply = (params: InitApplyParams) => Promise<InitResult>;

export async function runInitWizard(
  prompts: InitPrompts,
  apply: InitApply,
  maxAttempts = 3,
): Promise<InitResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const answers: InitWizardAnswers = {
      password: await prompts.password(),
      confirmPassword: await prompts.confirmPassword(),
      host: await prompts.host(),
      port: await prompts.port(),
      publicUrl: await prompts.publicUrl(),
      channel: await prompts.channel(),
    };

    let request: ReturnType<typeof buildInitRequest>;

    try {
      request = buildInitRequest(answers);
    } catch (error) {
      if (attempt + 1 >= maxAttempts) {
        throw error;
      }
      prompts.notify?.(error instanceof Error ? error.message : String(error));
      continue;
    }

    const summary = [
      `监听: ${answers.host}:${answers.port}`,
      `canonical origin: ${request.origin}`,
      `RP ID: ${request.rpId}`,
      `Passkey: ${request.passkeyEnabled ? "可用" : "不可用（将仅支持 allow_once）"}`,
      `更新通道: ${answers.channel}`,
      ...(request.warning === null ? [] : ["", request.warning]),
    ].join("\n");

    if (!(await prompts.confirm(summary))) {
      throw new Error("初始化已取消");
    }

    return apply(request.params);
  }

  throw new Error("初始化失败：重试次数已用尽");
}
