import { type AppConfig, DEFAULT_APP_CONFIG } from "@larness/shared";
import type { InitResult } from "../init/service.js";
import type { InitApplyParams } from "../ipc/protocol.js";
import { buildInitRequest, TuiError } from "./init-wizard.js";

export interface InitPrompts {
  advanced(): Promise<boolean>;
  host(): Promise<string>;
  port(): Promise<string>;
  publicUrl(): Promise<string>;
  confirm(summary: string): Promise<boolean>;
  notify?(message: string): void;
}

export type InitApply = (params: InitApplyParams) => Promise<InitResult>;

export async function runInitWizard(
  prompts: InitPrompts,
  apply: InitApply,
  options: {
    config?: AppConfig;
    initialParams?: InitApplyParams;
    env?: NodeJS.ProcessEnv;
    maxAttempts?: number;
  } = {},
): Promise<InitResult> {
  const config = options.config ?? DEFAULT_APP_CONFIG;
  const defaults = config.server;
  const maxAttempts = options.maxAttempts ?? 3;
  const advanced = await prompts.advanced();
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const answers = advanced
      ? {
          host: await prompts.host(),
          port: await prompts.port(),
          publicUrl: await prompts.publicUrl(),
        }
      : { host: defaults.host, port: String(defaults.port), publicUrl: defaults.publicUrl ?? "" };
    let request: ReturnType<typeof buildInitRequest>;
    const params: InitApplyParams = { ...options.initialParams };
    try {
      request = buildInitRequest(answers);
      for (const [key, variable] of [
        ["host", "LARNESS_HOST"],
        ["port", "LARNESS_PORT"],
        ["publicUrl", "LARNESS_PUBLIC_URL"],
      ] as const) {
        if (request.params[key] !== defaults[key]) {
          if (options.env?.[variable] !== undefined)
            throw new TuiError(`${variable} 覆盖了此设置，请修改环境变量后重启`);
          Object.assign(params, { [key]: request.params[key] });
        }
      }
    } catch (error) {
      if (attempt + 1 >= maxAttempts) throw error;
      prompts.notify?.(error instanceof Error ? error.message : String(error));
      continue;
    }
    const summary = [
      `监听: ${request.params.host}:${request.params.port}`,
      `浏览器访问地址: ${request.origin}`,
      `RP ID: ${request.rpId}`,
      `Passkey: ${request.passkeyEnabled ? "可用" : "不可用（将仅支持 allow_once）"}`,
      ...(request.warning === null ? [] : [request.warning]),
    ].join("\n");
    if (!(await prompts.confirm(summary))) throw new Error("初始化已取消");
    return apply(params);
  }
  throw new Error("初始化失败：重试次数已用尽");
}
