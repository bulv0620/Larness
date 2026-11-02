import { z } from "zod";

export const StatusSchema = z.object({
  version: z.string(),
  running: z.boolean(),
  initialized: z.boolean(),
  listen: z.object({ host: z.string(), port: z.number() }),
  sessions: z.object({ online: z.number(), pendingPairings: z.number() }),
  warnings: z.array(z.string()),
});
export type ScreenStatus = z.infer<typeof StatusSchema>;
export const InitStatusSchema = z.object({ initialized: z.boolean() });
export const InitResultSchema = z.object({
  origin: z.string(),
  rpId: z.string(),
  restartRequired: z.boolean(),
});
export const LogLinesSchema = z.object({ lines: z.array(z.string()).max(500) });
export const AuditSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        action: z.string(),
        decision: z.string().nullable(),
        resourceType: z.string().nullable(),
        resourceId: z.string().nullable(),
        createdAt: z.number(),
        details: z.unknown(),
      }),
    )
    .max(200),
});

export const PairingListSchema = z.object({
  requests: z.array(
    z.object({
      requestId: z.string(),
      shortCode: z.string(),
      status: z.string(),
      decision: z.enum(["allow_once", "trust"]).nullable(),
      clientLabel: z.string().nullable(),
      clientOrigin: z.string().nullable(),
      userAgent: z.string().nullable(),
      createdAt: z.number(),
      expiresAt: z.number(),
      trustAvailable: z.boolean(),
    }),
  ),
});
export const DevicesSchema = z.object({
  devices: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      createdAt: z.number(),
      lastSeenAt: z.number().nullable(),
      revokedAt: z.number().nullable(),
      credentials: z.array(
        z.object({
          id: z.string(),
          type: z.string(),
          backupEligible: z.boolean(),
          backupState: z.boolean(),
          createdAt: z.number(),
          lastUsedAt: z.number().nullable(),
          revokedAt: z.number().nullable(),
        }),
      ),
    }),
  ),
});
export const PairCodeSchema = z.object({ code: z.string().min(1).max(64), expiresAt: z.number() });
export const RevokeSchema = z.object({
  ok: z.literal(true),
  revokedCredentials: z.number(),
  revokedSessions: z.number(),
});
export const OkSchema = z.object({ ok: z.literal(true) });
