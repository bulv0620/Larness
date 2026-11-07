import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { listRecentAudit } from "../../src/db/repositories/audit.js";
import { listSessionEvents } from "../../src/modules/agent/events.js";
import { refreshModelCatalog } from "../../src/modules/models/catalog.js";
import { createCredential } from "../../src/modules/models/service.js";
import { createProject } from "../../src/modules/projects/service.js";
import { SessionError } from "../../src/modules/sessions/errors.js";
import {
  archiveSession,
  createSession,
  getSessionDetail,
  updateSession,
} from "../../src/modules/sessions/service.js";
import { cancelTurn, createTurn } from "../../src/modules/sessions/turns.js";
import { SecretStore } from "../../src/security/secretStore.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

describe("turn service", () => {
  it("creates a queued turn and persists the user message before turn.created", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const optionsWithClock = { db: opened.db, dataDir: dir, now: () => clock.value++ };
        const session = await createSession(optionsWithClock, {});
        const created = createTurn(optionsWithClock, {
          sessionId: session.id,
          text: "  hello world  ",
        });

        expect(created).toMatchObject({ status: "QUEUED", sessionId: session.id });
        const page = listSessionEvents(opened.db, session.id);
        expect(page.items.map((event) => event.type)).toEqual(["user.message", "turn.created"]);
        expect(page.items.map((event) => event.sequence)).toEqual([1, 2]);
        expect(page.items[0]?.payload).toEqual({ turnId: created.turnId, text: "hello world" });

        const detail = getSessionDetail(optionsWithClock, session.id);
        expect(detail.activeTurn?.id).toBe(created.turnId);
        expect(detail.activeTurn?.input.text).toBe("hello world");
        expect(listRecentAudit(opened.db).map((row) => row.action)).toContain("turn.started");
      } finally {
        opened.close();
      }
    });
  });

  it("returns the first turn for a repeated Idempotency-Key and rejects a second active turn", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const optionsWithClock = { db: opened.db, dataDir: dir, now: () => clock.value++ };
        const session = await createSession(optionsWithClock, {});
        const first = createTurn(optionsWithClock, {
          sessionId: session.id,
          text: "first",
          idempotencyKey: "retry-1",
        });

        const retry = createTurn(optionsWithClock, {
          sessionId: session.id,
          text: "ignored retry body",
          idempotencyKey: "retry-1",
        });
        expect(retry).toEqual(first);

        expect(() =>
          createTurn(optionsWithClock, {
            sessionId: session.id,
            text: "second",
            idempotencyKey: "retry-2",
          }),
        ).toThrowError(expect.objectContaining({ code: "TURN_IN_PROGRESS" }));

        expect(opened.sqlite.prepare("SELECT count(*) AS n FROM turns").get()).toEqual({ n: 1 });
        expect(opened.sqlite.prepare("SELECT count(*) AS n FROM agent_events").get()).toEqual({
          n: 2,
        });

        opened.sqlite.prepare("UPDATE turns SET status = 'COMPLETED'").run();
        const completedRetry = createTurn(optionsWithClock, {
          sessionId: session.id,
          text: "retry after completion",
          idempotencyKey: "retry-1",
        });
        expect(completedRetry).toMatchObject({
          turnId: first.turnId,
          status: "COMPLETED",
        });

        const next = createTurn(optionsWithClock, {
          sessionId: session.id,
          text: "next turn",
          idempotencyKey: "retry-3",
        });
        expect(next.turnId).not.toBe(first.turnId);
      } finally {
        opened.close();
      }
    });
  });

  it("keeps idempotency keys scoped to a session", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const optionsWithClock = { db: opened.db, dataDir: dir, now: () => clock.value++ };
        const sessionA = await createSession(optionsWithClock, {});
        const sessionB = await createSession(optionsWithClock, {});

        const turnA = createTurn(optionsWithClock, {
          sessionId: sessionA.id,
          text: "a",
          idempotencyKey: "shared-key",
        });
        const turnB = createTurn(optionsWithClock, {
          sessionId: sessionB.id,
          text: "b",
          idempotencyKey: "shared-key",
        });

        expect(turnA.turnId).not.toBe(turnB.turnId);
        expect(
          listSessionEvents(opened.db, sessionA.id).items.map((item) => item.sequence),
        ).toEqual([1, 2]);
        expect(
          listSessionEvents(opened.db, sessionB.id).items.map((item) => item.sequence),
        ).toEqual([1, 2]);
      } finally {
        opened.close();
      }
    });
  });

  it("allows only one of two simultaneously submitted turns", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const optionsWithClock = { db: opened.db, dataDir: dir, now: () => clock.value++ };
        const session = await createSession(optionsWithClock, {});

        const results = await Promise.allSettled([
          Promise.resolve().then(() =>
            createTurn(optionsWithClock, {
              sessionId: session.id,
              text: "first",
              idempotencyKey: "concurrent-1",
            }),
          ),
          Promise.resolve().then(() =>
            createTurn(optionsWithClock, {
              sessionId: session.id,
              text: "second",
              idempotencyKey: "concurrent-2",
            }),
          ),
        ]);

        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const rejected = results.find((result) => result.status === "rejected");
        expect(rejected).toMatchObject({
          status: "rejected",
          reason: { code: "TURN_IN_PROGRESS" },
        });
        expect(opened.sqlite.prepare("SELECT count(*) AS n FROM turns").get()).toEqual({ n: 1 });
      } finally {
        opened.close();
      }
    });
  });

  it("cancels an active turn once and rejects cancelling a finished turn", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const optionsWithClock = { db: opened.db, dataDir: dir, now: () => clock.value++ };
        const session = await createSession(optionsWithClock, {});
        const turn = createTurn(optionsWithClock, { sessionId: session.id, text: "run" });

        const cancelled = cancelTurn(optionsWithClock, { turnId: turn.turnId });
        expect(cancelled.status).toBe("CANCELLING");
        expect(cancelTurn(optionsWithClock, { turnId: turn.turnId }).status).toBe("CANCELLING");

        const page = listSessionEvents(opened.db, session.id);
        expect(page.items.map((event) => event.type)).toEqual([
          "user.message",
          "turn.created",
          "turn.status",
        ]);
        expect(page.items[2]?.payload).toEqual({
          turnId: turn.turnId,
          status: "CANCELLING",
          reason: "user",
        });

        opened.sqlite.prepare("UPDATE turns SET status = 'COMPLETED'").run();
        expect(() => cancelTurn(optionsWithClock, { turnId: turn.turnId })).toThrowError(
          expect.objectContaining({ code: "CONFLICT" }),
        );
        expect(() => cancelTurn(optionsWithClock, { turnId: "trn_missing" })).toThrowError(
          expect.objectContaining({ code: "NOT_FOUND" }),
        );
      } finally {
        opened.close();
      }
    });
  });

  it("rejects turns for archived sessions and invalid input", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const optionsWithClock = { db: opened.db, dataDir: dir, now: () => clock.value++ };
        const session = await createSession(optionsWithClock, {});
        archiveSession(optionsWithClock, { id: session.id });

        expect(() =>
          createTurn(optionsWithClock, { sessionId: session.id, text: "nope" }),
        ).toThrowError(expect.objectContaining({ code: "CONFLICT" }));

        const active = await createSession(optionsWithClock, {});
        expect(() =>
          createTurn(optionsWithClock, { sessionId: active.id, text: "   " }),
        ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
        expect(() =>
          createTurn(optionsWithClock, { sessionId: active.id, text: "x".repeat(100_001) }),
        ).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }));
        expect(() =>
          createTurn(optionsWithClock, { sessionId: "ses_missing", text: "x" }),
        ).toThrowError(expect.objectContaining({ code: "NOT_FOUND" }));
      } finally {
        opened.close();
      }
    });
  });

  it("passes the requested model profile to the next turn", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);
      await mkdir(path.join(dir, "project"), { recursive: true });

      try {
        const project = await createProject(
          { db: opened.db, detectGit: async () => false, now: () => 1 },
          { rootPath: path.join(dir, "project") },
        );
        const clock = { value: 1_000 };
        const optionsWithClock = { db: opened.db, dataDir: dir, now: () => clock.value++ };
        const session = await createSession(optionsWithClock, { projectId: project.id });
        const turn = createTurn(optionsWithClock, {
          sessionId: session.id,
          text: "next",
          modelProfileId: "mdl_deepseek",
        });

        expect(getSessionDetail(optionsWithClock, session.id).activeTurn).toMatchObject({
          id: turn.turnId,
          modelProfileId: "mdl_deepseek",
          provider: null,
          model: null,
        });
      } finally {
        opened.close();
      }
    });
  });

  it("names a new session from the first user message", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const options = { db: opened.db, dataDir: dir, now: () => 1_000 };
        const session = await createSession(options, {});
        expect(getSessionDetail(options, session.id).title).toBe("New session");

        createTurn(options, {
          sessionId: session.id,
          text: "  Build a   small FTP server\nwith a status endpoint  ",
        });
        expect(getSessionDetail(options, session.id).title).toBe(
          "Build a small FTP server with a status endpoint",
        );

        const renamed = await createSession(options, { title: "Keep me" });
        createTurn(options, { sessionId: renamed.id, text: "first turn" });
        expect(getSessionDetail(options, renamed.id).title).toBe("Keep me");

        const long = await createSession(options, {});
        createTurn(options, { sessionId: long.id, text: "x".repeat(80) });
        expect(getSessionDetail(options, long.id).title).toHaveLength(48);
        expect(getSessionDetail(options, long.id).title.endsWith("…")).toBe(true);
      } finally {
        opened.close();
      }
    });
  });
  it("snapshots the catalog model, thinking and window for a turn", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const store = await SecretStore.open(dir);
        createCredential(
          { db: opened.db, secretStore: store },
          { provider: "deepseek", label: "DeepSeek Key", apiKey: "sk-test" },
        );
        await refreshModelCatalog(
          {
            db: opened.db,
            secretStore: store,
            fetcher: async () => ({
              data: [{ id: "deepseek-flash" }, { id: "deepseek-chat" }],
            }),
          },
          { clientSessionId: "bs_test" },
        );

        const options = { db: opened.db, dataDir: dir, now: () => 5_000 };
        const session = await createSession(options, {});
        const created = createTurn(options, {
          sessionId: session.id,
          text: "use the catalog model",
          model: "deepseek-flash",
          thinking: "high",
        });

        const detail = getSessionDetail(options, session.id);
        expect(detail.activeTurn).toMatchObject({
          id: created.turnId,
          provider: "deepseek",
          model: "deepseek-flash",
          thinking: "high",
          contextWindow: 1_048_576,
          modelProfileId: null,
        });
        expect(detail.model).toBe("deepseek-flash");
        expect(detail.thinking).toBe("high");
      } finally {
        opened.close();
      }
    });
  });

  it("inherits the session selection and rejects unsupported levels", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const store = await SecretStore.open(dir);
        createCredential(
          { db: opened.db, secretStore: store },
          { provider: "deepseek", label: "DeepSeek Key", apiKey: "sk-test" },
        );
        await refreshModelCatalog(
          {
            db: opened.db,
            secretStore: store,
            fetcher: async () => ({
              data: [{ id: "deepseek-flash" }, { id: "deepseek-chat" }],
            }),
          },
          { clientSessionId: "bs_test" },
        );

        const options = { db: opened.db, dataDir: dir, now: () => 6_000 };
        const session = await createSession(options, {});
        updateSession(options, { id: session.id, model: "deepseek-flash", thinking: "low" });

        const inherited = createTurn(options, { sessionId: session.id, text: "inherited" });
        expect(getSessionDetail(options, session.id).activeTurn).toMatchObject({
          id: inherited.turnId,
          model: "deepseek-flash",
          thinking: "low",
        });

        const other = await createSession(options, {});
        const errorCode = (run: () => unknown): string | undefined => {
          try {
            run();
            return undefined;
          } catch (error) {
            return (error as { code?: string }).code;
          }
        };

        expect(
          errorCode(() =>
            createTurn(options, {
              sessionId: other.id,
              text: "bad level",
              model: "deepseek-chat",
              thinking: "high",
            }),
          ),
        ).toBe("MODEL_UNSUPPORTED");
        expect(
          errorCode(() =>
            createTurn(options, {
              sessionId: other.id,
              text: "unknown model",
              model: "unknown-model",
            }),
          ),
        ).toBe("MODEL_UNSUPPORTED");
      } finally {
        opened.close();
      }
    });
  });
  it("snapshots the selected credential and rejects ambiguous keys", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const store = await SecretStore.open(dir);
        const first = createCredential(
          { db: opened.db, secretStore: store },
          { provider: "deepseek", label: "First", apiKey: "sk-first" },
        );
        createCredential(
          { db: opened.db, secretStore: store },
          { provider: "deepseek", label: "Second", apiKey: "sk-second" },
        );
        await refreshModelCatalog(
          {
            db: opened.db,
            secretStore: store,
            fetcher: async () => ({ data: [{ id: "deepseek-flash" }] }),
          },
          { clientSessionId: "bs_test" },
        );

        const options = { db: opened.db, dataDir: dir, now: () => 7_000 };
        const session = await createSession(options, {});
        const turn = createTurn(options, {
          sessionId: session.id,
          text: "use the first key",
          model: "deepseek-flash",
          credentialProfileId: first.id,
        });

        const detail = getSessionDetail(options, session.id);
        expect(detail.activeTurn).toMatchObject({
          id: turn.turnId,
          model: "deepseek-flash",
          credentialProfileId: first.id,
        });
        expect(detail.credentialProfileId).toBe(first.id);

        const other = await createSession(options, {});
        expect(() =>
          createTurn(options, {
            sessionId: other.id,
            text: "ambiguous",
            model: "deepseek-flash",
          }),
        ).toThrowError(SessionError);
      } finally {
        opened.close();
      }
    });
  });
});
