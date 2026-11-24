import path from "node:path";
import {
  createFakeProvider,
  createFileToolRegistry,
  type ProviderChunk,
  ProviderError,
} from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

function textStep(text: string): { chunks: ProviderChunk[] } {
  return {
    chunks: [
      { type: "text-delta", text },
      {
        type: "finish",
        finishReason: "stop",
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
      },
    ],
  };
}

function errorStep(code: string, statusCode?: number): { chunks: ProviderChunk[] } {
  return {
    chunks: [
      {
        type: "error",
        error: new ProviderError(
          code as ConstructorParameters<typeof ProviderError>[0],
          "provider request failed",
          statusCode === undefined ? {} : { statusCode },
        ),
      },
    ],
  };
}

describe("TurnRunner provider step retry", () => {
  it("retries a transient provider failure that produced no output", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "retry" });
        const provider = createFakeProvider([
          errorStep("PROVIDER_UNAVAILABLE", 502),
          textStep("recovered"),
        ]);
        const logs: { fields: Record<string, unknown>; message: string }[] = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          providerRetryDelayMs: 0,
          logger: {
            info: (fields, message) => logs.push({ fields, message }),
            warn: (fields, message) => logs.push({ fields, message }),
          },
        });

        const result = await runner.run(turn.turnId);

        expect(result.status).toBe("COMPLETED");
        expect(provider.calls).toHaveLength(2);
        expect(provider.calls[1]?.maxRetries).toBe(2);
        expect(logs).toContainEqual(
          expect.objectContaining({
            message: "provider step retry",
            fields: expect.objectContaining({
              attempt: 2,
              errorCode: "PROVIDER_UNAVAILABLE",
              statusCode: 502,
            }),
          }),
        );
      } finally {
        opened.close();
      }
    });
  });

  it("retries an unclassified provider failure that carries a 5xx status", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "retry" });
        const provider = createFakeProvider([
          errorStep("PROVIDER_UNKNOWN", 503),
          textStep("recovered"),
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          providerRetryDelayMs: 0,
        });

        const result = await runner.run(turn.turnId);

        expect(result.status).toBe("COMPLETED");
        expect(provider.calls).toHaveLength(2);
      } finally {
        opened.close();
      }
    });
  });

  it("gives up after two retries and reports the last provider failure", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "retry" });
        const provider = createFakeProvider([
          errorStep("PROVIDER_UNAVAILABLE", 502),
          errorStep("PROVIDER_UNAVAILABLE", 502),
          errorStep("PROVIDER_UNAVAILABLE", 502),
          textStep("never used"),
        ]);
        const logs: { fields: Record<string, unknown>; message: string }[] = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          providerRetryDelayMs: 0,
          logger: {
            info: (fields, message) => logs.push({ fields, message }),
            warn: (fields, message) => logs.push({ fields, message }),
          },
        });

        const result = await runner.run(turn.turnId);

        expect(result).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_UNAVAILABLE" });
        expect(provider.calls).toHaveLength(3);
        expect(logs).toContainEqual(
          expect.objectContaining({
            message: "provider step failed",
            fields: expect.objectContaining({
              attempts: 3,
              errorCode: "PROVIDER_UNAVAILABLE",
              statusCode: 502,
            }),
          }),
        );
      } finally {
        opened.close();
      }
    });
  });

  it("does not retry once the step has emitted output", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "stream" });
        const provider = createFakeProvider([
          {
            chunks: [
              { type: "text-delta", text: "partial answer" },
              {
                type: "error",
                error: new ProviderError("PROVIDER_UNAVAILABLE", "connection reset", {
                  statusCode: 502,
                }),
              },
            ],
          },
          textStep("duplicate answer"),
        ]);
        const published: unknown[] = [];
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          providerRetryDelayMs: 0,
          publish: (event) => {
            published.push(event);
          },
        });

        const result = await runner.run(turn.turnId);

        expect(result).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_UNAVAILABLE" });
        expect(provider.calls).toHaveLength(1);
        const deltas = published.filter(
          (event) => (event as { kind?: string }).kind === "assistant.delta",
        );
        expect(deltas).toHaveLength(1);
        expect(deltas[0]).toMatchObject({ text: "partial answer" });
      } finally {
        opened.close();
      }
    });
  });

  it("does not retry terminal provider errors", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionOptions = { db: opened.db, dataDir: dir };
        const session = await createSession(sessionOptions, {});
        const turn = createTurn(sessionOptions, { sessionId: session.id, text: "auth" });
        const provider = createFakeProvider([
          errorStep("PROVIDER_AUTH_FAILED", 401),
          textStep("never used"),
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
          providerRetryDelayMs: 0,
        });

        const result = await runner.run(turn.turnId);

        expect(result).toMatchObject({ status: "FAILED", errorCode: "PROVIDER_AUTH_FAILED" });
        expect(provider.calls).toHaveLength(1);
      } finally {
        opened.close();
      }
    });
  });
});
