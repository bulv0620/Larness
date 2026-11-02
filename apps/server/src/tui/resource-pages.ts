import type { z } from "zod";
import type { IpcClient } from "../ipc/client.js";
import { IpcClientError } from "../ipc/client.js";
import { formatPairingCode } from "../pairing/code.js";
import { disconnected, displayError } from "./page-error.js";
import {
  DevicesSchema,
  OkSchema,
  PairCodeSchema,
  PairingListSchema,
  RevokeSchema,
} from "./schemas.js";
import { bodyLines, clipLine } from "./screen.js";
import type { TerminalSession } from "./terminal.js";

type Pair = z.infer<typeof PairingListSchema>["requests"][number];
type Device = z.infer<typeof DevicesSchema>["devices"][number];
type Kind = "pairing" | "devices";
type View = "list" | "actions" | "confirm" | "code" | "detail";
const time = (value: number | null) =>
  value === null
    ? "从未"
    : `${new Date(value).toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;

class ResourcePage {
  private view: View = "list";
  private pairs: Pair[] = [];
  private devices: Device[] = [];
  private selectedId: string | null = null;
  private selected = 0;
  private action = 0;
  private confirmed = false;
  private loading = false;
  private busy = false;
  private generation = 0;
  private error = "";
  private result = "";
  private offset = 0;
  private code: z.infer<typeof PairCodeSchema> | null = null;
  private fatal: unknown;
  private revokeConfirmed = false;
  private uncertain = false;
  private pairHandled = false;

  constructor(
    private kind: Kind,
    private terminal: TerminalSession,
    private client: Pick<IpcClient, "request">,
  ) {}
  private get pair(): Pair | undefined {
    return this.pairs.find((item) => item.requestId === this.selectedId);
  }
  private get device(): Device | undefined {
    return this.devices.find((item) => item.id === this.selectedId);
  }
  private choices(): string[] {
    if (this.uncertain || this.pairHandled) return ["返回列表"];
    return this.pair?.trustAvailable
      ? ["允许本次", "始终允许（注册 Passkey）", "拒绝", "返回"]
      : ["允许本次", "拒绝", "返回"];
  }
  private decision(): "allow_once" | "trust" | "deny" {
    if (this.action === 0) return "allow_once";
    return this.pair?.trustAvailable && this.action === 1 ? "trust" : "deny";
  }
  private failure(error: unknown, write = false): void {
    if (disconnected(error)) this.fatal = error;
    const uncertain =
      write &&
      error instanceof IpcClientError &&
      ["TIMEOUT", "CONNECTION_CLOSED"].includes(error.code);
    if (uncertain) {
      this.uncertain = true;
      this.action = 0;
    }
    this.error = uncertain
      ? "结果待确认：请刷新列表确认实际状态，写操作不会自动重试。配对码未收到时，请在浏览器重新申请。"
      : displayError(error);
  }
  private load(): void {
    if (this.loading || this.busy) return;
    this.loading = true;
    const generation = ++this.generation;
    this.render();
    void this.client
      .request(
        this.kind === "pairing" ? "pairing.list" : "devices.list",
        this.kind === "pairing" ? { status: "pending" } : undefined,
      )
      .then((value) => {
        if (generation !== this.generation) return;
        if (this.kind === "pairing") this.pairs = PairingListSchema.parse(value).requests;
        else this.devices = DevicesSchema.parse(value).devices;
        const ids =
          this.kind === "pairing"
            ? this.pairs.map((item) => item.requestId)
            : this.devices.map((item) => item.id);
        const previous = this.selectedId === null ? -1 : ids.indexOf(this.selectedId);
        this.selected =
          previous >= 0 ? previous : Math.max(0, Math.min(this.selected, ids.length - 1));
        this.selectedId = ids[this.selected] ?? null;
        this.error = "";
        this.uncertain = false;
        if (!this.selectedId) this.view = "list";
      })
      .catch((error: unknown) => {
        if (generation === this.generation) this.failure(error);
      })
      .finally(() => {
        if (generation === this.generation) {
          this.loading = false;
          this.render();
          this.terminal.notify();
        }
      });
  }
  private submit(): void {
    if (this.busy || this.uncertain || this.pairHandled) return;
    const pair = this.pair;
    const device = this.device;
    const decision = this.decision();
    if (
      (this.kind === "pairing" && !pair) ||
      (this.kind === "devices" && (!device || device.revokedAt !== null || this.revokeConfirmed))
    )
      return;
    this.busy = true;
    this.error = "";
    this.confirmed = false;
    this.terminal.blockInput(true);
    const generation = ++this.generation;
    this.render();
    const method =
      this.kind === "devices"
        ? "devices.revoke"
        : decision === "deny"
          ? "pairing.deny"
          : "pairing.approve";
    const params =
      this.kind === "devices"
        ? { deviceId: device?.id }
        : decision === "deny"
          ? { requestId: pair?.requestId }
          : { requestId: pair?.requestId, decision };
    void this.client
      .request(method, params)
      .then((value) => {
        if (generation !== this.generation) return;
        if (this.kind === "devices") {
          const revoked = RevokeSchema.parse(value);
          this.result = `已撤销设备：凭据 ${revoked.revokedCredentials} 个，会话 ${revoked.revokedSessions} 个`;
          this.revokeConfirmed = true;
          this.view = "detail";
        } else if (decision === "deny") {
          OkSchema.parse(value);
          this.result = "已拒绝配对申请";
          this.pairHandled = true;
          this.action = 0;
          this.view = "actions";
        } else {
          this.code = PairCodeSchema.parse(value);
          this.view = "code";
        }
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return;
        this.failure(error, true);
        this.view = this.kind === "devices" ? "detail" : "actions";
      })
      .finally(() => {
        if (generation === this.generation) {
          this.busy = false;
          this.terminal.blockInput(false);
          this.offset = 0;
          this.render();
          this.terminal.notify();
        }
      });
  }
  private content(): { title: string; body: string[]; footer: string } {
    if (this.view === "code" && this.code)
      return {
        title: "配对码",
        body: [
          "",
          `    ${formatPairingCode(this.code.code)}`,
          "",
          `申请：${this.pair?.shortCode ?? ""} · ${this.decision() === "trust" ? "始终允许" : "允许本次"}`,
          `到期：${time(this.code.expiresAt)}`,
          "仅显示本次，不会延长有效期。",
        ],
        footer: "Enter 返回控制面板 · Esc 返回配对列表 · Ctrl+C 停止",
      };
    if (this.view === "list") {
      const labels =
        this.kind === "pairing"
          ? this.pairs.map(
              (item) =>
                `${item.shortCode} · ${item.clientLabel ?? "未知客户端"} · ${item.clientOrigin ?? "未知来源"}`,
            )
          : this.devices.map(
              (item) => `${item.label} · ${item.revokedAt === null ? "有效" : "已撤销"}`,
            );
      return {
        title: this.kind === "pairing" ? "待审批配对" : "可信设备",
        body: [
          this.loading ? "正在读取…" : `${labels.length} 项`,
          "",
          ...(labels.length
            ? labels.map((label, index) =>
                clipLine(
                  `${this.selected === index ? "›" : " "} ${label}`,
                  this.terminal.columns - 1,
                ),
              )
            : [this.loading ? "" : this.error ? "读取未成功" : "暂无记录"]),
          "",
          this.error,
        ],
        footer: "↑↓ 选择 · Enter 打开 · r 刷新 · Esc 返回控制面板",
      };
    }
    if (this.view === "confirm")
      return {
        title:
          this.kind === "devices"
            ? "撤销确认"
            : this.decision() === "deny"
              ? "拒绝确认"
              : "批准确认",
        body: [
          this.kind === "devices"
            ? `撤销 ${this.device?.label ?? "设备"} 及关联会话？`
            : `确认${this.choices()[this.action] ?? "批准"}申请 ${this.pair?.shortCode ?? ""}？`,
          "",
          `${this.confirmed ? "  " : "› "}取消`,
          `${this.confirmed ? "› " : "  "}确认`,
          "",
          this.busy ? "正在提交，请等待结果…" : "",
        ],
        footer: this.busy
          ? "写操作已发送，返回不会撤销 · Ctrl+C 停止"
          : "↑↓ 选择 · Enter 确认 · Esc 取消",
      };
    if (this.view === "actions") {
      const pair = this.pair;
      return {
        title: "配对操作",
        body: [
          `申请：${pair?.shortCode ?? ""}`,
          `来源：${pair?.clientOrigin ?? "未知"}`,
          `客户端：${pair?.clientLabel ?? "未知"}`,
          `UA：${clipLine(pair?.userAgent ?? "未知", 140)}`,
          `申请时间：${time(pair?.createdAt ?? 0)}`,
          "",
          ...this.choices().map(
            (choice, index) => `${this.action === index ? "›" : " "} ${choice}`,
          ),
          "",
          this.result,
          this.error,
        ],
        footer: "↑↓ 选择 · Enter 打开 · r 刷新列表 · Esc 返回列表",
      };
    }
    const device = this.device;
    return {
      title: "设备详情",
      body: [
        `设备：${device?.label ?? "未找到"}`,
        `状态：${device?.revokedAt !== null || this.revokeConfirmed ? "已撤销" : "有效"}`,
        `创建：${time(device?.createdAt ?? 0)}`,
        `最后在线：${time(device?.lastSeenAt ?? null)}`,
        ...(device?.credentials.flatMap((credential) => [
          "",
          `${credential.type} · ${credential.revokedAt === null && !this.revokeConfirmed ? "有效" : "已撤销"}`,
          `允许备份：${credential.backupEligible ? "是" : "否"} · 已备份：${credential.backupState ? "是" : "否"}`,
          `最后使用：${time(credential.lastUsedAt)}`,
        ]) ?? []),
        "",
        this.result,
        this.error,
      ],
      footer:
        device?.revokedAt === null && !this.revokeConfirmed && !this.uncertain
          ? "↑↓ 滚动 · Enter 撤销设备 · r 刷新 · Esc 返回列表"
          : "↑↓ 滚动 · r 刷新 · Esc 返回列表",
    };
  }
  private render(): void {
    const frame = this.content();
    const length = bodyLines(frame.body, this.terminal.columns).length;
    this.offset = Math.max(0, Math.min(this.offset, length - this.terminal.bodyHeight));
    this.terminal.render({ ...frame, offset: this.offset });
  }
  async run(): Promise<void> {
    this.load();
    try {
      for (;;) {
        const key = await this.terminal.nextKey();
        if (this.fatal !== undefined) throw this.fatal;
        if (key.name === "update" || this.busy) continue;
        if (key.name === "escape") {
          if (this.view === "list") return;
          ++this.generation;
          this.loading = false;
          this.code = null;
          this.offset = 0;
          if (this.view === "confirm") this.view = this.kind === "devices" ? "detail" : "actions";
          else {
            this.view = "list";
            this.result = "";
            this.load();
          }
          this.render();
          continue;
        }
        if (key.name === "r" && this.view !== "code" && this.view !== "confirm") {
          if (this.view === "actions") this.view = "list";
          this.load();
          continue;
        }
        if (this.loading) continue;
        if (this.view === "code") {
          if (key.name === "return") return;
          continue;
        }
        if (this.view === "list" && ["up", "down"].includes(key.name)) {
          const ids =
            this.kind === "pairing"
              ? this.pairs.map((item) => item.requestId)
              : this.devices.map((item) => item.id);
          this.selected = Math.max(
            0,
            Math.min(ids.length - 1, this.selected + (key.name === "up" ? -1 : 1)),
          );
          this.selectedId = ids[this.selected] ?? null;
          const row = this.selected + 2;
          if (row < this.offset) this.offset = row;
          else if (row >= this.offset + this.terminal.bodyHeight)
            this.offset = row - this.terminal.bodyHeight + 1;
        } else if (this.view === "actions" && ["up", "down"].includes(key.name))
          this.action = Math.max(
            0,
            Math.min(this.choices().length - 1, this.action + (key.name === "up" ? -1 : 1)),
          );
        else if (this.view === "confirm" && ["up", "down"].includes(key.name))
          this.confirmed = !this.confirmed;
        else if (
          this.view === "detail" &&
          ["up", "down", "pageup", "pagedown", "home", "end"].includes(key.name)
        ) {
          this.offset =
            key.name === "home"
              ? 0
              : key.name === "end"
                ? Number.MAX_SAFE_INTEGER
                : this.offset +
                  (key.name.includes("up") ? -1 : 1) *
                    (key.name.startsWith("page") ? this.terminal.bodyHeight : 1);
        } else if (key.name === "return") {
          if (this.view === "list" && this.selectedId) {
            this.view = this.kind === "devices" ? "detail" : "actions";
            this.action = 0;
            this.offset = 0;
            this.result = "";
            this.revokeConfirmed = false;
            this.pairHandled = false;
          } else if (this.view === "actions") {
            if (this.action === this.choices().length - 1) {
              this.view = "list";
              this.load();
            } else {
              this.view = "confirm";
              this.confirmed = false;
            }
          } else if (
            this.view === "detail" &&
            this.device?.revokedAt === null &&
            !this.revokeConfirmed
          ) {
            this.view = "confirm";
            this.confirmed = false;
            this.offset = 0;
          } else if (this.view === "confirm") {
            if (this.confirmed) this.submit();
            else this.view = this.kind === "devices" ? "detail" : "actions";
          }
        }
        this.render();
      }
    } finally {
      ++this.generation;
      this.code = null;
      this.pairs = [];
      this.devices = [];
      this.terminal.blockInput(false);
      this.terminal.render({ title: "返回", body: [], footer: "Ctrl+C 停止服务" });
    }
  }
}

export function runResourcePage(
  kind: Kind,
  deps: { terminal: TerminalSession; client: Pick<IpcClient, "request"> },
): Promise<void> {
  return new ResourcePage(kind, deps.terminal, deps.client).run();
}
