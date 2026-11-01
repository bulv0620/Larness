import type { IpcClient } from "../ipc/client.js";

export interface DeviceCredentialItem {
  id: string;
  type: string;
  backupEligible: boolean;
  backupState: boolean;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface DeviceItem {
  id: string;
  label: string;
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
  credentials: DeviceCredentialItem[];
}

export interface DevicesViewDeps {
  client: Pick<IpcClient, "request">;
  out(text: string): void;
  ask(message: string): Promise<string>;
}

export function formatDevices(devices: DeviceItem[]): string {
  if (devices.length === 0) {
    return "可信设备: 无";
  }

  const lines = ["可信设备:"];

  devices.forEach((device, index) => {
    const credential = device.credentials[0];
    const status = device.revokedAt === null ? "active" : "revoked";
    const backup =
      credential === undefined
        ? "no credential"
        : `Passkey · backup eligible=${credential.backupEligible} state=${credential.backupState}`;
    const lastUsed =
      credential?.lastUsedAt === null || credential?.lastUsedAt === undefined
        ? "never"
        : new Date(credential.lastUsedAt).toISOString();

    lines.push(
      `  [${index + 1}] ${device.label} (${status})`,
      `      ${backup} · created ${new Date(device.createdAt).toISOString()} · last used ${lastUsed}`,
    );
  });

  return lines.join("\n");
}

export async function runDevicesView(deps: DevicesViewDeps): Promise<void> {
  const listed = (await deps.client.request("devices.list")) as { devices: DeviceItem[] };
  deps.out(formatDevices(listed.devices));

  if (listed.devices.length === 0) {
    return;
  }

  const answer = (await deps.ask("输入设备编号撤销（回车返回）: ")).trim();
  const index = Number(answer);

  if (!Number.isInteger(index) || index < 1 || index > listed.devices.length) {
    return;
  }

  const device = listed.devices[index - 1];

  if (device === undefined || device.revokedAt !== null) {
    deps.out("该设备已撤销或不存在");
    return;
  }

  const confirmed =
    (await deps.ask(`确认撤销 ${device.label}？(y/N): `)).trim().toLowerCase() === "y";

  if (!confirmed) {
    return;
  }

  try {
    const result = (await deps.client.request("devices.revoke", {
      deviceId: device.id,
    })) as { revokedCredentials: number; revokedSessions: number };

    deps.out(
      `已撤销设备：credential ${result.revokedCredentials} 个，会话 ${result.revokedSessions} 个`,
    );
  } catch (error) {
    deps.out(`撤销失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}
