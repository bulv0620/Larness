import { OriginUrlSchema } from "@larness/shared";
import { z } from "zod";

export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 1024 * 1024;
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60_000;
export const MAX_CONNECTIONS = 8;

export const IPC_ERROR_CODES = [
  "INVALID_TOKEN",
  "PROTOCOL_MISMATCH",
  "METHOD_NOT_FOUND",
  "VALIDATION_ERROR",
  "NOT_INITIALIZED",
  "ALREADY_INITIALIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "INTERNAL",
] as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

export class IpcError extends Error {
  readonly code: IpcErrorCode;

  constructor(code: IpcErrorCode, message: string) {
    super(message);
    this.name = "IpcError";
    this.code = code;
  }
}

export const RequestEnvelopeSchema = z.object({
  id: z.string().min(1).max(128),
  method: z.string().min(1).max(64),
  params: z.unknown().optional(),
});

export type RequestEnvelope = z.infer<typeof RequestEnvelopeSchema>;

export const HelloParamsSchema = z
  .object({
    token: z.string().min(1).max(256),
    client: z.string().min(1).max(64),
    pid: z.int().positive().optional(),
  })
  .strict();

export const InitApplyParamsSchema = z
  .object({
    host: z.string().min(1).max(255).optional(),
    port: z.int().min(1).max(65535).optional(),
    publicUrl: OriginUrlSchema.nullable().optional(),
    channel: z.enum(["stable", "beta"]).optional(),
  })
  .strict();

export type InitApplyParams = z.infer<typeof InitApplyParamsSchema>;

export const LogsTailParamsSchema = z
  .object({ lines: z.int().min(1).max(500).optional() })
  .strict();

export const AuditTailParamsSchema = z
  .object({ limit: z.int().min(1).max(200).optional() })
  .strict();

export const ShutdownParamsSchema = z.object({ confirm: z.literal(true) }).strict();

export const PairingListParamsSchema = z
  .object({
    status: z
      .enum(["pending", "approved", "denied", "expired", "enrollment_pending", "redeemed"])
      .optional(),
  })
  .strict();

export const PairingApproveParamsSchema = z
  .object({
    requestId: z.string().min(1).max(128),
    decision: z.enum(["allow_once", "trust"]),
  })
  .strict();

export const PairingDenyParamsSchema = z.object({ requestId: z.string().min(1).max(128) }).strict();

export const DeviceRevokeParamsSchema = z.object({ deviceId: z.string().min(1).max(128) }).strict();

export const SessionRevokeParamsSchema = z
  .object({ sessionId: z.string().min(1).max(128) })
  .strict();

export type IpcResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: { code: IpcErrorCode; message: string } };

export type IpcEvent = { event: string; data: unknown };

export function errorResponse(id: string, error: unknown): IpcResponse {
  if (error instanceof IpcError) {
    return { id, ok: false, error: { code: error.code, message: error.message } };
  }

  return { id, ok: false, error: { code: "INTERNAL", message: "Internal IPC error" } };
}
