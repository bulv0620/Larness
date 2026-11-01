import { ERROR_HTTP_STATUS } from "@larness/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { HttpError } from "../errors.js";
import {
  createCredential,
  createModelProfile,
  deleteCredential,
  listCredentialDtos,
  listModelDtos,
  ModelError,
} from "../modules/models/service.js";
import type { SecretStore } from "../security/secretStore.js";

const ProviderSchema = z.enum(["deepseek", "openai-compatible"]);
const IdSchema = z.string().min(1).max(128);

const CreateCredentialSchema = z
  .object({
    provider: ProviderSchema,
    label: z.string().min(1).max(64),
    apiKey: z.string().min(1).max(8_192),
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

  app.get("/api/models", async () => ({ models: listModelDtos(options) }));

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
      const credential = createCredential(options, {
        provider: body.provider,
        label: body.label,
        apiKey: body.apiKey,
        clientSessionId: request.clientSession?.id,
      });
      return reply.code(201).send(credential);
    } catch (error) {
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
