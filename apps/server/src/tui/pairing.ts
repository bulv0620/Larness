import type { IpcClient } from "../ipc/client.js";
import { formatPairingCode } from "../pairing/code.js";

export interface PairingItem {
  requestId: string;
  shortCode: string;
  status: string;
  decision: "allow_once" | "trust" | null;
  clientLabel: string | null;
  clientOrigin: string | null;
  userAgent: string | null;
  createdAt: number;
  expiresAt: number;
  trustAvailable: boolean;
}

export interface PairingViewDeps {
  client: Pick<IpcClient, "request">;
  out(text: string): void;
  ask(message: string): Promise<string>;
}

export function formatPairingRequests(items: PairingItem[]): string {
  if (items.length === 0) {
    return "待审批配对申请: 无";
  }

  const lines = ["待审批配对申请:"];

  for (const item of items) {
    lines.push(
      `  ${item.shortCode}  ${item.clientOrigin ?? "unknown origin"}`,
      `    ${item.clientLabel ?? "unknown client"} · ${new Date(item.createdAt).toISOString()}`,
      `    始终允许: ${item.trustAvailable ? "可用" : "不可用（非 canonical 来源或 WebAuthn 未配置）"}`,
    );
  }

  return lines.join("\n");
}

export async function runPairingView(deps: PairingViewDeps): Promise<void> {
  const listed = (await deps.client.request("pairing.list", { status: "pending" })) as {
    requests: PairingItem[];
  };

  deps.out(formatPairingRequests(listed.requests));

  if (listed.requests.length === 0) {
    return;
  }

  const shortCode = (await deps.ask("输入短编号审批（回车返回）: ")).trim();

  if (shortCode.length === 0) {
    return;
  }

  const item = listed.requests.find((request) => request.shortCode === shortCode);

  if (item === undefined) {
    deps.out("未找到该短编号对应的待审批申请");
    return;
  }

  const choices = item.trustAvailable
    ? "a=允许本次 / t=始终允许（注册 Passkey） / d=拒绝"
    : "a=允许本次 / d=拒绝（该来源不支持始终允许）";
  const choice = (await deps.ask(`${choices}: `)).trim().toLowerCase();

  if (choice === "d") {
    const confirmed = (await deps.ask("确认拒绝该申请？(y/N): ")).trim().toLowerCase() === "y";

    if (!confirmed) {
      return;
    }

    try {
      await deps.client.request("pairing.deny", { requestId: item.requestId });
      deps.out("已拒绝配对申请");
    } catch (error) {
      deps.out(`拒绝失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    return;
  }

  if (choice !== "a" && choice !== "t") {
    return;
  }

  if (choice === "t" && !item.trustAvailable) {
    deps.out("该来源不支持始终允许；请选择允许本次，或改用 canonical origin");
    return;
  }

  const decision = choice === "t" ? "trust" : "allow_once";
  const confirmed = (await deps.ask("确认批准该申请？(y/N): ")).trim().toLowerCase() === "y";

  if (!confirmed) {
    return;
  }

  try {
    const result = (await deps.client.request("pairing.approve", {
      requestId: item.requestId,
      decision,
    })) as { code: string; expiresAt: number };

    deps.out(
      `配对码: ${formatPairingCode(result.code)}（${new Date(result.expiresAt).toISOString()} 前有效，仅显示一次）`,
    );
  } catch (error) {
    deps.out(`审批失败: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }

  await deps.ask("按回车返回控制面板: ");
}
