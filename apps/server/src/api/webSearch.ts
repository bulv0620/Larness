import { ERROR_HTTP_STATUS, type ErrorCode } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { WEB_SEARCH_PROVIDER_IDS, WEB_SEARCH_REGIONS } from "../db/schema.js";
import { HttpError } from "../errors.js";
import {
  createWebSearchConnection,
  deleteWebSearchConnection,
  listWebSearchConnections,
  resolveWebSearchConnection,
  updateWebSearchConnection,
  WebSearchConfigError,
} from "../modules/web-search/connections.js";
import { WebSearchError } from "../modules/web-search/errors.js";
import { WebSearchService } from "../modules/web-search/service.js";
import {
  getWebSearchSettings,
  setWebSearchSettings,
  WebSearchSettingsSchema,
} from "../modules/web-search/settings.js";
import type { SecretStore } from "../security/secretStore.js";

const ProviderSchema = z.enum(WEB_SEARCH_PROVIDER_IDS);
const RegionSchema = z.enum(WEB_SEARCH_REGIONS);
const IdSchema = z.string().min(1).max(128);

const CreateConnectionSchema = z
  .object({
    provider: ProviderSchema,
    label: z.string().min(1).max(64),
    apiKey: z.string().min(1).max(8_192),
    region: RegionSchema.optional(),
  })
  .strict();

const UpdateConnectionSchema = z
  .object({
    label: z.string().min(1).max(64).optional(),
    apiKey: z.string().min(1).max(8_192).optional(),
    region: RegionSchema.optional(),
  })
  .strict();

const SettingsSchema = WebSearchSettingsSchema.omit({ version: true }).extend({
  activeConnectionId: IdSchema.nullable(),
});

export interface WebSearchApiDeps {
  db: Database;
  secretStore: SecretStore;
  service?: WebSearchService;
  now?: () => number;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);

  if (!parsed.success) {
    throw new HttpError("VALIDATION_ERROR", "Invalid request", {
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  return parsed.data;
}

function throwWebSearch(error: unknown): never {
  if (error instanceof WebSearchConfigError) {
    throw new HttpError(error.code, error.message, {
      status: ERROR_HTTP_STATUS[error.code],
    });
  }

  if (error instanceof WebSearchError) {
    const code: ErrorCode =
      error.code === "WEB_SEARCH_AUTH_FAILED"
        ? "PROVIDER_AUTH_FAILED"
        : error.code === "WEB_SEARCH_QUOTA_EXCEEDED"
          ? "PROVIDER_QUOTA_EXHAUSTED"
          : error.code === "WEB_SEARCH_RATE_LIMITED"
            ? "PROVIDER_RATE_LIMITED"
            : "PROVIDER_UNAVAILABLE";
    throw new HttpError(code, error.message, { status: ERROR_HTTP_STATUS[code] });
  }

  throw error;
}

export function registerWebSearchRoutes(app: FastifyInstance, deps: WebSearchApiDeps): void {
  const options = { db: deps.db, secretStore: deps.secretStore, now: deps.now };
  const service = deps.service ?? new WebSearchService();

  app.get("/api/web-search/connections", async () => ({
    connections: listWebSearchConnections(deps.db),
  }));

  app.post("/api/web-search/connections", async (request, reply) => {
    const body = parse(CreateConnectionSchema, request.body);

    try {
      const connection = createWebSearchConnection(options, {
        ...body,
        clientSessionId: request.clientSession?.id,
      });
      return reply.code(201).send(connection);
    } catch (error) {
      throwWebSearch(error);
    }
  });

  app.patch<{ Params: { id: string } }>("/api/web-search/connections/:id", async (request) => {
    const body = parse(UpdateConnectionSchema, request.body);

    try {
      return updateWebSearchConnection(options, {
        id: request.params.id,
        ...body,
        clientSessionId: request.clientSession?.id,
      });
    } catch (error) {
      throwWebSearch(error);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/web-search/connections/:id", async (request) => {
    try {
      deleteWebSearchConnection(options, request.params.id, request.clientSession?.id);
      return { ok: true };
    } catch (error) {
      throwWebSearch(error);
    }
  });

  app.post<{ Params: { id: string } }>("/api/web-search/connections/:id/test", async (request) => {
    try {
      const resolved = resolveWebSearchConnection(options, request.params.id);
      const result = await service.testConnection(resolved.connection, resolved.apiKey);
      return { ok: true, ...result };
    } catch (error) {
      throwWebSearch(error);
    }
  });

  app.get("/api/web-search/settings", async () => ({
    ...getWebSearchSettings(deps.db),
    connections: listWebSearchConnections(deps.db),
  }));

  app.put("/api/web-search/settings", async (request) => {
    const body = parse(SettingsSchema, request.body);

    if (
      body.activeConnectionId !== null &&
      !listWebSearchConnections(deps.db).some((item) => item.id === body.activeConnectionId)
    ) {
      throw new HttpError("VALIDATION_ERROR", "active search connection does not exist");
    }

    try {
      setWebSearchSettings(deps.db, { version: 1, ...body }, deps.now?.() ?? Date.now());
      return {
        ...getWebSearchSettings(deps.db),
        connections: listWebSearchConnections(deps.db),
      };
    } catch (error) {
      throwWebSearch(error);
    }
  });
}
