import { OriginUrlSchema } from "@larness/shared";
import { z } from "zod";

export const HMR_PATH = "/_larness/dev/hmr";
export const NONCE_MARKER = "LARNESS_DEV_RESPONSE_NONCE";
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
