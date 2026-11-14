import { ProviderError } from "@larness/agent";
import { ERROR_HTTP_STATUS } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { HttpError } from "../errors.js";
import { overrideSchema } from "../modules/models/capabilities.js";
import {
  type DeepSeekCatalogFetcher,
  getModelCatalog,
  refreshModelCatalog,
  setCatalogCapabilityOverride,
  setCatalogDefault,
  setCatalogModelVisibility,
} from "../modules/models/catalog.js";
import { assertSafeEndpoint, EndpointError } from "../modules/models/endpoint.js";
import { MODEL_CONNECTION_PRESETS } from "../modules/models/presets.js";
import { type ModelProbeResolver, probeModelConnection } from "../modules/models/probe.js";
import { getCredentialRow } from "../modules/models/repository.js";
import {
  createCredential,
  createModelProfile,
  deleteCredential,
  listCredentialDtos,
  listModelDtos,
  ModelError,
  resolveCredentialRoute,
  updateCredentialSettings,
} from "../modules/models/service.js";
import type { SecretStore } from "../security/secretStore.js";

const ProviderSchema = z.enum(["deepseek", "glm", "openai-compatible"]);
const IdSchema = z.string().min(1).max(128);

const UpdateCredentialSchema = z
  .object({
    endpoint: z.string().max(512).nullable().optional(),
    contextWindow: z.number().int().nullable().optional(),
    revision: z.number().int().positive().optional(),
    label: z.string().min(1).max(64).optional(),
    apiKey: z.string().min(1).max(8_192).optional(),
  })
  .strict();

const CatalogRefreshSchema = z
  .object({
    credentialProfileId: IdSchema.optional(),
    includePublicDirectory: z.boolean().optional(),
  })
  .strict();
const ModelOverrideKeySchema = z
  .object({ credentialProfileId: IdSchema, modelId: IdSchema })
  .strict();
const ModelOverrideSchema = ModelOverrideKeySchema.extend({
  override: overrideSchema.refine(
    (value) => Object.keys(value).length > 0,
    "provide at least one capability",
  ),
});

const DefaultSchema = z
  .object({
    model: z.string().min(1).max(128),
    credentialProfileId: z.string().min(1).max(128),
    thinking: z.string().min(1).max(32).optional(),
  })
  .strict();

const VisibilitySchema = z
  .object({
    credentialProfileId: z.string().min(1).max(128),
    modelId: z.string().min(1).max(128),
    visible: z.boolean(),
  })
  .strict();

const CreateCredentialSchema = z
  .object({
    provider: ProviderSchema.optional(),
    presetId: IdSchema.optional(),
    label: z.string().min(1).max(64),
    apiKey: z.string().min(1).max(8_192),
    endpoint: z.string().max(512).optional(),
    contextWindow: z.number().int().optional(),
  })
  .strict();

const CreateModelSchema = z
  .object({
    label: z.string().min(1).max(64),
    provider: ProviderSchema,
    model: z.string().min(1).max(128),
    credentialProfileId: z.string().min(1).max(128).optional(),
    endpoint: z.string().url().max(2_048).optional(),
  })
  .strict();

export interface ModelApiDeps {
  db: Database;
  secretStore: SecretStore;
  catalogFetcher?: DeepSeekCatalogFetcher;
  modelProbeResolver?: ModelProbeResolver;
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

function throwModel(error: unknown): never {
  if (error instanceof ModelError) {
    throw new HttpError(error.code, error.message, {
      status: ERROR_HTTP_STATUS[error.code],
      details: error.details,
    });
  }

  throw error;
}

export function registerModelRoutes(app: FastifyInstance, deps: ModelApiDeps): void {
  const options = { db: deps.db, secretStore: deps.secretStore, now: deps.now };
  const catalogOptions = {
    ...options,
    ...(deps.catalogFetcher === undefined ? {} : { fetcher: deps.catalogFetcher }),
  };

  app.get("/api/models", async () => ({ models: listModelDtos(options) }));

  app.get("/api/models/presets", async () => ({ presets: MODEL_CONNECTION_PRESETS }));

  app.get("/api/models/catalog", async () => {
    try {
      return getModelCatalog(catalogOptions);
    } catch (error) {
      throwModel(error);
    }
  });

  app.put("/api/models/default", async (request) => {
    const body = DefaultSchema.parse(request.body);

    try {
      const selection = setCatalogDefault(catalogOptions, {
        ...body,
        clientSessionId: request.clientSession?.id,
      });
      return { ok: true, defaultSelection: selection };
    } catch (error) {
      throwModel(error);
    }
  });

  app.patch("/api/models/catalog/visibility", async (request) => {
    const body = parse(VisibilitySchema, request.body);

    try {
      setCatalogModelVisibility(catalogOptions, {
        credentialProfileId: body.credentialProfileId,
        modelId: body.modelId,
        visible: body.visible,
        clientSessionId: request.clientSession?.id,
      });
      return { ok: true };
    } catch (error) {
      throwModel(error);
    }
  });

  app.post("/api/models/catalog/refresh", async (request) => {
    const body = parse(CatalogRefreshSchema, request.body ?? {});
    try {
      return await refreshModelCatalog(catalogOptions, {
        ...body,
        clientSessionId: request.clientSession?.id,
      });
    } catch (error) {
      throwModel(error);
    }
  });

  app.put("/api/models/catalog/overrides", async (request) => {
    const body = parse(ModelOverrideSchema, request.body);
    try {
      setCatalogCapabilityOverride(catalogOptions, {
        ...body,
        clientSessionId: request.clientSession?.id,
      });
      return { ok: true };
    } catch (error) {
      throwModel(error);
    }
  });

  app.delete("/api/models/catalog/overrides", async (request) => {
    const body = parse(ModelOverrideKeySchema, request.body);
    try {
      setCatalogCapabilityOverride(catalogOptions, {
        ...body,
        override: null,
        clientSessionId: request.clientSession?.id,
      });
      return { ok: true };
    } catch (error) {
      throwModel(error);
    }
  });

  app.post("/api/models", async (request, reply) => {
    const body = parse(CreateModelSchema, request.body);

    try {
      const model = createModelProfile(options, {
        label: body.label,
        provider: body.provider,
        model: body.model,
        ...(body.credentialProfileId === undefined
          ? {}
          : { credentialProfileId: body.credentialProfileId }),
        ...(body.endpoint === undefined ? {} : { endpoint: body.endpoint }),
        clientSessionId: request.clientSession?.id,
      });
      return reply.code(201).send(model);
    } catch (error) {
      throwModel(error);
    }
  });

  app.get("/api/credentials", async () => ({
    credentials: listCredentialDtos(options),
  }));

  app.post("/api/credentials", async (request, reply) => {
    const body = parse(CreateCredentialSchema, request.body);

    try {
      const route = resolveCredentialRoute(body);
      let endpoint = route.endpoint;

      if (route.provider === "openai-compatible") {
        try {
          endpoint = (await assertSafeEndpoint(endpoint ?? "")).toString().replace(/\/$/, "");
        } catch (error) {
          throw new HttpError(
            "VALIDATION_ERROR",
            error instanceof EndpointError ? error.message : "invalid endpoint",
          );
        }
      }

      const credential = createCredential(options, {
        provider: route.provider,
        presetId: body.presetId,
        label: body.label,
        apiKey: body.apiKey,
        endpoint,
        contextWindow: body.contextWindow,
        clientSessionId: request.clientSession?.id,
      });
      return reply.code(201).send(credential);
    } catch (error) {
      throwModel(error);
    }
  });

  app.patch<{ Params: { id: string } }>("/api/credentials/:id", async (request) => {
    const id = parse(IdSchema, request.params.id);
    const body = parse(UpdateCredentialSchema, request.body);

    try {
      const credential = getCredentialRow(options.db, id);

      if (credential === null) {
        throw new HttpError("NOT_FOUND", "credential not found");
      }

      let endpoint = body.endpoint;

      if (
        credential.provider === "openai-compatible" &&
        endpoint !== undefined &&
        endpoint !== null
      ) {
        try {
          endpoint = (await assertSafeEndpoint(endpoint)).toString().replace(/\/$/, "");
        } catch (error) {
          throw new HttpError(
            "VALIDATION_ERROR",
            error instanceof EndpointError ? error.message : "invalid endpoint",
          );
        }
      }

      return updateCredentialSettings(options, {
        ...body,
        id,
        endpoint,
        clientSessionId: request.clientSession?.id,
      });
    } catch (error) {
      throwModel(error);
    }
  });

  app.post<{ Params: { id: string } }>("/api/credentials/:id/test", async (request) => {
    const id = parse(IdSchema, request.params.id);
    const body = parse(z.object({ model: IdSchema }).strict(), request.body);
    if (!deps.modelProbeResolver)
      throw new HttpError("PROVIDER_UNAVAILABLE", "Model testing is unavailable");
    try {
      await probeModelConnection(catalogOptions, deps.modelProbeResolver, {
        credentialProfileId: id,
        model: body.model,
      });
      return { ok: true };
    } catch (error) {
      if (error instanceof ProviderError) {
        throw new HttpError(
          error.code === "PROVIDER_ABORTED" ? "PROVIDER_UNAVAILABLE" : error.code,
          "Model test failed",
        );
      }
      throwModel(error);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/credentials/:id", async (request) => {
    const id = parse(IdSchema, request.params.id);

    try {
      deleteCredential(options, {
        id,
        clientSessionId: request.clientSession?.id,
      });
      return { ok: true };
    } catch (error) {
      throwModel(error);
    }
  });
}
