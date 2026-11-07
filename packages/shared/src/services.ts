import { z } from "zod";
import { TerminalIdSchema } from "./terminals";

export const ServiceIdSchema = z.string().regex(/^svc_[a-f0-9-]{36}$/);
export const ServiceStatusSchema = z.enum([
  "REGISTERING",
  "STARTING",
  "RUNNING",
  "UNKNOWN",
  "UNREGISTERED",
]);
export type ServiceStatus = z.infer<typeof ServiceStatusSchema>;
export const ServiceKindSchema = z.literal("temporary");
export type ServiceKind = z.infer<typeof ServiceKindSchema>;
export const ServiceEndpointSchema = z
  .object({
    host: z.enum(["127.0.0.1", "::1"]),
    port: z.number().int().min(1).max(65535),
    protocol: z.literal("http"),
  })
  .strict();
export type ServiceEndpoint = z.infer<typeof ServiceEndpointSchema>;

export const ServiceRegisterInputSchema = z
  .object({
    kind: ServiceKindSchema.describe(
      "temporary development preview only; registration does not create a persistent PM2 service",
    ),
    terminalId: TerminalIdSchema.describe(
      "Managed terminal owning the real listening process; not a PM2 targetId or pm2Name",
    ),
    name: z.string().trim().min(1).max(80),
    endpoint: ServiceEndpointSchema.describe(
      "Use the terminal listener's port and a loopback host value. The backend discovers the actual bind address, including wildcard listeners.",
    ),
  })
  .strict();
export type ServiceRegisterInput = z.infer<typeof ServiceRegisterInputSchema>;

export const ServiceDtoSchema = z.object({
  id: ServiceIdSchema,
  projectId: z.string().min(1).max(128),
  sourceSessionId: z.string().min(1).max(128).nullable(),
  name: z.string().min(1).max(80),
  kind: ServiceKindSchema,
  status: ServiceStatusSchema,
  terminalId: TerminalIdSchema,
  terminalExecutionId: z.string().min(1).max(128),
  endpointGeneration: z.number().int().nonnegative(),
  endpoint: ServiceEndpointSchema,
  previewEligible: z.boolean(),
  reasonCode: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  endedAt: z.number().int().nullable(),
});
export type ServiceDto = z.infer<typeof ServiceDtoSchema>;

export const ServiceListSchema = z.object({
  items: z.array(ServiceDtoSchema),
  nextCursor: z.string().nullable(),
});

export const ServiceActionViewSchema = z.object({
  id: z.string().min(1).max(128),
  projectId: z.string().min(1).max(128),
  kind: z.literal("service.register"),
  risk: z.literal("L2"),
  status: z.enum([
    "PREPARED",
    "WAITING_APPROVAL",
    "APPROVED",
    "RUNNING",
    "COMPLETED",
    "FAILED",
    "REJECTED",
    "EXPIRED",
    "INTERRUPTED",
  ]),
  params: ServiceRegisterInputSchema,
  paramsHash: z.string(),
  snapshotVersion: z.string(),
  requestedBy: z.string(),
  decidedBy: z.string().nullable(),
  expiresAt: z.number().int(),
  decidedAt: z.number().int().nullable(),
  startedAt: z.number().int().nullable(),
  endedAt: z.number().int().nullable(),
  result: z.unknown(),
  createdAt: z.number().int(),
});
export type ServiceActionView = z.infer<typeof ServiceActionViewSchema>;

export const ServiceEventPayloadSchema = z.object({
  status: ServiceStatusSchema,
  terminalId: TerminalIdSchema,
  terminalExecutionId: z.string().min(1).max(128),
  endpointGeneration: z.number().int().nonnegative(),
  reasonCode: z.string().nullable(),
});
export type ServiceEventPayload = z.infer<typeof ServiceEventPayloadSchema>;

export const ServiceSubscriptionSchema = z
  .object({
    topic: z.literal("service"),
    resourceId: ServiceIdSchema,
    after: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  })
  .strict();
