import { deriveWebAuthn, type UpdateChannel } from "@larness/shared";
import { validateAdminPassword } from "../init/password.js";
import type { InitApplyParams } from "../ipc/protocol.js";

export class TuiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TuiError";
  }
}

export interface InitWizardAnswers {
  password: string;
  confirmPassword: string;
  host: string;
  port: string;
  publicUrl: string;
  channel: UpdateChannel;
}

export interface InitRequest {
  params: InitApplyParams;
  origin: string;
  rpId: string;
  passkeyEnabled: boolean;
  warning: string | null;
}

export function buildInitRequest(answers: InitWizardAnswers): InitRequest {
  const passwordError = validateAdminPassword(answers.password);

  if (passwordError !== null) {
    throw new TuiError(passwordError);
  }

  if (answers.password !== answers.confirmPassword) {
    throw new TuiError("两次输入的管理员密码不一致");
  }

  const port = Number(answers.port.trim());

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TuiError("端口必须是 1-65535 的整数");
  }

  const host = answers.host.trim();

  if (host.length === 0) {
    throw new TuiError("监听地址不能为空");
  }

  const publicUrl = answers.publicUrl.trim() === "" ? null : answers.publicUrl.trim();
  const webAuthn = deriveWebAuthn({ port, publicUrl }, "Larness");

  return {
    params: {
      adminPassword: answers.password,
      host,
      port,
      publicUrl,
      channel: answers.channel,
    },
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
