import { tmpdir } from "node:os";
import path from "node:path";
import { OriginUrlSchema } from "@larness/shared";
import { z } from "zod";

export const HMR_PATH = "/_larness/dev/hmr";
export const NONCE_MARKER = "LARNESS_DEV_RESPONSE_NONCE";
export class DevWebUnavailable extends Error {
  readonly code = "DEV_WEB_UNAVAILABLE";
  constructor() {
    super("开发运行环境已停止，请重新启动 TUI");
  }
}
export class EntryConfigError extends Error {
  constructor(origin: string, port: number) {
    const canonical = new URL(OriginUrlSchema.parse(origin));
    const targetPort = Number(canonical.port || (canonical.protocol === "https:" ? 443 : 80));
    super(
      `浏览器地址是 ${canonical.origin}，Server 监听端口是 ${port}。请关闭实例，一次性将 config.json 的 server.port 对齐为 ${targetPort}，保留 publicUrl 和其他配置；若端口来自环境变量，请调整对应环境变量。`,
    );
  }
}
export const devWebCache = (generation: string): string =>
  path.join(tmpdir(), `larness-vite-cache-${z.uuid().parse(generation)}`);
export const DevWebTargetSchema = z.strictObject({
  generation: z.uuid(),
  host: z.literal("127.0.0.1"),
  port: z.int().min(1).max(65535),
});
export type DevWebTarget = z.infer<typeof DevWebTargetSchema>;
export const DevWebReadySchema = DevWebTargetSchema.extend({ type: z.literal("dev-web.ready") });
export const DevWebAttachSchema = DevWebTargetSchema.extend({ type: z.literal("dev-web.attach") });
export const DevWebAttachedSchema = z.strictObject({
  type: z.literal("dev-web.attached"),
  generation: z.uuid(),
});
export const DevWebStartSchema = z.strictObject({
  type: z.literal("dev-web.start"),
  generation: z.uuid(),
  origin: OriginUrlSchema,
});

export class DevWebControl {
  private current: DevWebTarget | null = null;
  private closed = false;
  constructor(
    private child: object,
    private generation: string,
  ) {}
  get target(): DevWebTarget | null {
    return this.current;
  }
  accept(child: object, message: unknown): boolean {
    const parsed = DevWebReadySchema.safeParse(message);
    if (
      this.closed ||
      child !== this.child ||
      !parsed.success ||
      parsed.data.generation !== this.generation
    )
      return false;
    const { type: _type, ...target } = parsed.data;
    if (this.current && this.current.port !== target.port) return false;
    this.current = target;
    return true;
  }
  close(): void {
    this.closed = true;
    this.current = null;
  }
}
