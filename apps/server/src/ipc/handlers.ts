import type { AppConfig, WebAuthnRuntime } from "@larness/shared";
import type { z } from "zod";
import type { Database } from "../db/client.js";
import { listRecentAudit } from "../db/repositories/audit.js";
import { getAuthSettings } from "../db/repositories/auth-settings.js";
import { countOnlineSessions, countPendingPairings } from "../db/stats.js";
import { runDoctor } from "../doctor.js";
import { applyInit, InitError } from "../init/service.js";
import {
  approvePairingRequest,
  denyPairingRequest,
  listPairingRequests,
  PairingError,
  type PairingErrorCode,
} from "../pairing/service.js";
import { collectStatus } from "../status.js";
import { DeviceAdminError, listDevices, revokeDevice } from "../webauthn/service.js";
import { readNewestLogLines } from "./logs.js";
import {
  AuditTailParamsSchema,
  DeviceRevokeParamsSchema,
  InitApplyParamsSchema,
  IpcError,
  type IpcErrorCode,
  LogsTailParamsSchema,
  PairingApproveParamsSchema,
  PairingDenyParamsSchema,
  PairingListParamsSchema,
  ShutdownParamsSchema,
} from "./protocol.js";
import type { IpcHandler } from "./server.js";

export interface IpcHandlerDeps {
  db: Database;
  dataDir: string;
  config: AppConfig;
  webAuthn: WebAuthnRuntime;
  csrfKey: Buffer;
  requestShutdown: (reason: string) => void;
  now?: () => number;
}

function parseParams<T>(schema: z.ZodType<T>, params: unknown): T {
  const parsed = schema.safeParse(params ?? {});

  if (!parsed.success) {
    throw new IpcError(
      "VALIDATION_ERROR",
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  }

  return parsed.data;
}

const PAIRING_IPC_ERRORS: Record<PairingErrorCode, IpcErrorCode> = {
  NOT_INITIALIZED: "NOT_INITIALIZED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  PAIRING_DENIED: "FORBIDDEN",
  PAIRING_EXPIRED: "FORBIDDEN",
  CODE_INVALID: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  WEBAUTHN_NOT_CONFIGURED: "FORBIDDEN",
  ORIGIN_INVALID: "FORBIDDEN",
};

function mapPairingError(error: unknown): unknown {
  if (error instanceof PairingError) {
    return new IpcError(PAIRING_IPC_ERRORS[error.code], error.message);
  }

  return error;
}

function parseDetails(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

export function createIpcHandler(deps: IpcHandlerDeps): IpcHandler {
  const now = deps.now ?? Date.now;

  return async (request, context) => {
    switch (request.method) {
      case "system.status": {
        const status = await collectStatus({ dataDir: deps.dataDir });
        const initialized = getAuthSettings(deps.db) !== null;

        return {
          ...status,
          initialized,
          running: true,
          listen: {
            host: deps.config.server.host,
            port: deps.config.server.port,
          },
          publicUrl: deps.config.server.publicUrl,
          webauthn: {
            enabled: deps.webAuthn.enabled,
            rpId: deps.webAuthn.rpId,
            origin: deps.webAuthn.origin,
            reason: deps.webAuthn.reason,
          },
          ipc: { ok: true, clients: context.ipcClients },
          sessions: {
            online: countOnlineSessions(deps.db, now()),
            pendingPairings: countPendingPairings(deps.db),
          },
        };
      }

      case "system.doctor":
        return runDoctor({ dataDir: deps.dataDir });

      case "init.status":
        return {
          initialized: getAuthSettings(deps.db) !== null,
          requiredFields: ["adminPassword", "host", "port"],
        };

      case "init.apply": {
        const params = parseParams(InitApplyParamsSchema, request.params);

        try {
          const result = await applyInit({
            db: deps.db,
            dataDir: deps.dataDir,
            currentConfig: deps.config,
            now: now(),
            input: {
              adminPassword: params.adminPassword,
              host: params.host,
              port: params.port,
              publicUrl: params.publicUrl ?? null,
              channel: params.channel,
            },
          });

          return { ok: true, ...result };
        } catch (error) {
          if (error instanceof InitError) {
            throw new IpcError(error.code, error.message);
          }
          throw error;
        }
      }

      case "pairing.list": {
        const params = parseParams(PairingListParamsSchema, request.params);
        const requests = listPairingRequests(deps, { status: params.status, now: now() }).map(
          (row) => ({
            requestId: row.id,
            shortCode: row.shortCode,
            status: row.status,
            decision: row.decision,
            clientLabel: row.clientLabel,
            clientOrigin: row.clientOrigin,
            userAgent: row.userAgent,
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            trustAvailable:
              row.status === "pending" &&
              deps.webAuthn.enabled &&
              row.clientOrigin === deps.webAuthn.origin,
          }),
        );

        return { requests };
      }

      case "pairing.approve": {
        const params = parseParams(PairingApproveParamsSchema, request.params);

        try {
          const result = approvePairingRequest(deps, {
            requestId: params.requestId,
            decision: params.decision,
            now: now(),
          });
          return { code: result.code, expiresAt: result.expiresAt };
        } catch (error) {
          throw mapPairingError(error);
        }
      }

      case "pairing.deny": {
        const params = parseParams(PairingDenyParamsSchema, request.params);

        try {
          denyPairingRequest(deps, { requestId: params.requestId, now: now() });
          return { ok: true };
        } catch (error) {
          throw mapPairingError(error);
        }
      }

      case "devices.list": {
        return {
          devices: listDevices(deps).map(({ device, credentials }) => ({
            id: device.id,
            label: device.label,
            createdAt: device.createdAt,
            lastSeenAt: device.lastSeenAt,
            revokedAt: device.revokedAt,
            credentials: credentials.map((credential) => ({
              id: credential.id,
              type: "passkey",
              backupEligible: credential.backupEligible,
              backupState: credential.backupState,
              createdAt: credential.createdAt,
              lastUsedAt: credential.lastUsedAt,
              revokedAt: credential.revokedAt,
            })),
          })),
        };
      }

      case "devices.revoke": {
        const params = parseParams(DeviceRevokeParamsSchema, request.params);

        try {
          const result = revokeDevice(deps, { deviceId: params.deviceId });
          return { ok: true, ...result };
        } catch (error) {
          if (error instanceof DeviceAdminError) {
            throw new IpcError(
              error.code === "NOT_FOUND" ? "NOT_FOUND" : "CONFLICT",
              error.message,
            );
          }
          throw error;
        }
      }

      case "logs.tail": {
        const params = parseParams(LogsTailParamsSchema, request.params);
        return { lines: await readNewestLogLines(deps.dataDir, params.lines ?? 200) };
      }

      case "audit.tail": {
        const params = parseParams(AuditTailParamsSchema, request.params);
        const items = listRecentAudit(deps.db, params.limit ?? 200).map((row) => ({
          id: row.id,
          action: row.action,
          decision: row.decision,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          createdAt: row.createdAt,
          details: parseDetails(row.detailsJson),
        }));

        return { items };
      }

      case "server.shutdown": {
        parseParams(ShutdownParamsSchema, request.params);
        setTimeout(() => deps.requestShutdown("ipc"), 100).unref();
        return { ok: true };
      }

      default:
        throw new IpcError("METHOD_NOT_FOUND", `unknown IPC method: ${request.method}`);
    }
  };
}
