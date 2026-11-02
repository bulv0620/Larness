import { deriveWebAuthn } from "@larness/shared";
import { InitApplyParamsSchema } from "../ipc/protocol.js";

export class TuiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TuiError";
  }
}

export interface InitWizardAnswers {
  host: string;
  port: string;
  publicUrl: string;
}

export function buildInitRequest(answers: InitWizardAnswers) {
  const port = Number(answers.port.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new TuiError("端口必须是 1-65535 的整数");
  const parsed = InitApplyParamsSchema.required({
    host: true,
    port: true,
    publicUrl: true,
  }).safeParse({
    host: answers.host.trim(),
    port,
    publicUrl: answers.publicUrl.trim() || null,
  });
  if (!parsed.success)
    throw new TuiError("监听地址或浏览器访问地址不合法；地址须为不带路径的 http(s) 来源");
  const params = parsed.data;
  const webAuthn = deriveWebAuthn(params, "Larness");
  return {
    params,
    origin: webAuthn.origin,
    rpId: webAuthn.rpId,
    passkeyEnabled: webAuthn.enabled,
    warning:
      webAuthn.reason === "rp_id_is_ip"
        ? "警告：RP ID 是 IP 地址，Passkey 不可用，只能使用 allow_once"
        : webAuthn.reason === "remote_http"
          ? "警告：远程 http 来源，Passkey 不可用，只能使用 allow_once"
          : null,
  };
}
