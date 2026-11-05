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
    kind: ServiceKindSchema,
    terminalId: TerminalIdSchema,
    name: z.string().trim().min(1).max(80),
    endpoint: ServiceEndpointSchema,
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

export const ServiceEventPayloadSchema = z.object({
  status: ServiceStatusSchema,
  terminalId: TerminalIdSchema,
  terminalExecutionId: z.string().min(1).max(128),
  endpointGeneration: z.number().int().nonnegative(),
  reasonCode: z.string().nullable(),
});
export type ServiceEventPayload = z.infer<typeof ServiceEventPayloadSchema>;
