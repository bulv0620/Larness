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
