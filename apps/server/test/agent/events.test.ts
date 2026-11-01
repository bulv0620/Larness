import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { immediateTransaction } from "../../src/db/transaction.js";
import { appendAgentEvent, listSessionEvents } from "../../src/modules/agent/events.js";
import { createProject } from "../../src/modules/projects/service.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

describe("agent events", () => {
  it("allocates a continuous session-scoped sequence", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const session = await createSession({ db: opened.db, dataDir: dir }, {});

        for (let index = 1; index <= 5; index += 1) {
          immediateTransaction(opened.db, (tx) =>
            appendAgentEvent(tx, {
              sessionId: session.id,
              type: "user.message",
              payload: { index },
              now: 1_000 + index,
            }),
          );
        }

        const sequences = opened.sqlite
          .prepare("SELECT seq FROM agent_events ORDER BY seq")
          .all() as { seq: number }[];
        expect(sequences.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);

        const page = listSessionEvents(opened.db, session.id, { after: 0, limit: 2 });
        expect(page.items.map((item) => item.sequence)).toEqual([1, 2]);
        expect(page.nextSeq).toBe(2);
        expect(page.hasMore).toBe(true);

        const second = listSessionEvents(opened.db, session.id, { after: 2, limit: 2 });
        expect(second.items.map((item) => item.sequence)).toEqual([3, 4]);
        expect(second.nextSeq).toBe(4);
        expect(second.hasMore).toBe(true);

        const last = listSessionEvents(opened.db, session.id, { after: 4, limit: 2 });
        expect(last.items.map((item) => item.sequence)).toEqual([5]);
        expect(last.nextSeq).toBe(5);
        expect(last.hasMore).toBe(false);

        const beyond = listSessionEvents(opened.db, session.id, { after: 99 });
        expect(beyond).toEqual({ items: [], nextSeq: 99, hasMore: false });
      } finally {
        opened.close();
      }
    });
  });

  it("returns the ServerEvent envelope with session and project identity", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        await mkdir(path.join(dir, "demo"), { recursive: true });
        const project = await createProject(
          { db: opened.db, detectGit: async () => false, now: () => 1 },
          { rootPath: path.join(dir, "demo") },
        );
        const session = await createSession(
          { db: opened.db, dataDir: dir },
          { projectId: project.id },
        );

        immediateTransaction(opened.db, (tx) =>
          appendAgentEvent(tx, {
            sessionId: session.id,
            type: "turn.created",
            payload: { turnId: "trn_1", status: "QUEUED" },
            now: 2_000,
          }),
        );

        const [event] = listSessionEvents(opened.db, session.id).items;
        expect(event).toMatchObject({
          kind: "event",
          protocolVersion: 1,
          topic: "agent",
          streamId: session.id,
          sessionId: session.id,
          projectId: project.id,
          sequence: 1,
          timestamp: 2_000,
          type: "turn.created",
          payload: { turnId: "trn_1", status: "QUEUED" },
        });
        expect(event?.eventId).toMatch(/^evt_/);
      } finally {
        opened.close();
      }
    });
  });

  it("rejects duplicate sequence numbers inside a session", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const session = await createSession({ db: opened.db, dataDir: dir }, {});
        immediateTransaction(opened.db, (tx) =>
          appendAgentEvent(tx, { sessionId: session.id, type: "user.message", now: 1_000 }),
        );

        expect(() =>
          opened.sqlite
            .prepare(
              "INSERT INTO agent_events (id, session_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            )
            .run("evt_duplicate", session.id, 1, "turn.created", "{}", 1_000),
        ).toThrow(/UNIQUE/);
      } finally {
        opened.close();
      }
    });
  });

  it("isolates sequences across sessions and rejects unknown sessions", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const sessionA = await createSession({ db: opened.db, dataDir: dir }, {});
        const sessionB = await createSession({ db: opened.db, dataDir: dir }, {});

        for (const session of [sessionA, sessionB]) {
          for (let index = 1; index <= 2; index += 1) {
            immediateTransaction(opened.db, (tx) =>
              appendAgentEvent(tx, {
                sessionId: session.id,
                type: "user.message",
                payload: { index },
                now: 1_000 + index,
              }),
            );
          }
        }

        expect(
          listSessionEvents(opened.db, sessionA.id).items.map((item) => item.sequence),
        ).toEqual([1, 2]);
        expect(
          listSessionEvents(opened.db, sessionB.id).items.map((item) => item.sequence),
        ).toEqual([1, 2]);
        expect(() => listSessionEvents(opened.db, "ses_missing")).toThrowError(
          expect.objectContaining({ code: "NOT_FOUND" }),
        );
      } finally {
        opened.close();
      }
    });
  });
});
