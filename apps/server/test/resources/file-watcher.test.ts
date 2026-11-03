import { mkdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createDirectoryWatcher } from "@larness/resources";
import type { ServerEvent } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { cleanupExpired } from "../../src/db/cleanup.js";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { immediateTransaction } from "../../src/db/transaction.js";
import { FileWatchManager, type FileWatchOptions } from "../../src/modules/files/watcher.js";
import { createProject } from "../../src/modules/projects/service.js";
import { listResourceEvents, ResourceEventBus } from "../../src/modules/resources/events.js";
import { appendResourceEvent } from "../../src/modules/resources/repository.js";
import { send } from "../../src/ws/server.js";
import { withTempDir } from "../helpers.js";

async function waitFor(test: () => boolean) {
  const end = Date.now() + 4000;
  while (Date.now() < end) {
    if (test()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error("File watcher condition timed out");
}
async function fixture(dir: string, options: Partial<FileWatchOptions> = {}) {
  const root = path.join(dir, "project"),
    dataDir = path.join(dir, "data");
  await mkdir(root);
  await mkdir(dataDir);
  const opened = openDatabase(path.join(dataDir, "db"));
  runMigrations(opened.db);
  const project = await createProject({ db: opened.db }, { rootPath: root });
  const stream = `file:project:${project.id}`;
  const events = new ResourceEventBus();
  const received: ServerEvent[] = [];
  events.on((event) => {
    expect(
      opened.sqlite.prepare("SELECT id FROM resource_events WHERE id = ?").get(event.eventId),
    ).toBeDefined();
    received.push(event);
  });
  const watcher = new FileWatchManager({
    db: opened.db,
    dataDir,
    events,
    intervalMs: 30,
    debounceMs: 10,
    ...options,
  });
  return {
    root,
    opened,
    stream,
    received,
    watcher,
    async close() {
      await watcher.close();
      opened.close();
    },
  };
}

describe("bounded native file observation", () => {
  it("observes real writes, rename and deletion, and shares handles across observing clients", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        const file = path.join(f.root, "file");
        await writeFile(file, "original");
        expect(await f.watcher.subscribe("client-a", f.stream, ["."])).toMatchObject({
          resyncRequired: true,
          partial: false,
        });
        await f.watcher.subscribe("client-b", f.stream, ["."]);
        expect(f.watcher.watcherCount).toBe(1);
        await writeFile(file, "external-body-marker");
        await waitFor(() => f.received.some((event) => event.type === "file.changed"));
        await rename(file, path.join(f.root, "renamed"));
        await waitFor(() =>
          f.received.some((event) => JSON.stringify(event.payload).includes('"path":"renamed"')),
        );
        await rm(path.join(f.root, "renamed"));
        await waitFor(() =>
          f.received.some((event) =>
            JSON.stringify(event.payload).includes('"path":"renamed","changeType":"deleted"'),
          ),
        );
        expect(JSON.stringify(f.received)).not.toContain("external-body-marker");
        const seqs = f.received.map((event) => event.sequence);
        expect(seqs).toEqual(seqs.map((_, index) => index + 1));
        f.watcher.unsubscribe("client-a");
        expect(f.watcher.watcherCount).toBe(1);
        f.watcher.unsubscribe("client-b");
        expect(f.watcher.watcherCount).toBe(0);
      } finally {
        await f.close();
      }
    });
  });

  it("reports watcher and scan limits as partial monitoring without pretending to have complete history", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir, { maxWatchers: 1, scanLimit: 2 });
      try {
        for (const item of ["a", "b", "c"]) await mkdir(path.join(f.root, item));
        const limited = await f.watcher.subscribe("client", f.stream, ["a", "b"]);
        expect(limited.partial).toBe(true);
        expect(f.watcher.watcherCount).toBe(1);
        expect(
          f.received.some((event) => JSON.stringify(event.payload).includes("WATCH_LIMIT")),
        ).toBe(true);
        f.watcher.unsubscribe("client");
        expect((await f.watcher.subscribe("client", f.stream, ["."])).partial).toBe(true);
        expect(
          f.received.some((event) => JSON.stringify(event.payload).includes("SCAN_LIMIT")),
        ).toBe(true);
        await rmdir(path.join(f.root, "c"));
        await waitFor(() =>
          f.received.some((event) => JSON.stringify(event.payload).includes("RECOVERED")),
        );
      } finally {
        await f.close();
      }
    });
  });

  it("recovers from native errors, queue overflow and replacement of a watched directory", async () => {
    await withTempDir(async (dir) => {
      const changes: (() => void)[] = [],
        errors: (() => void)[] = [];
      let attachments = 0;
      const f = await fixture(dir, {
        queueLimit: 1,
        createWatcher: (directory, changed, failed) => {
          attachments++;
          changes.push(changed);
          errors.push(failed);
          return createDirectoryWatcher(directory, changed, failed);
        },
      });
      try {
        await mkdir(path.join(f.root, "sub"));
        await f.watcher.subscribe("client", f.stream, ["sub"]);
        changes[0]?.();
        changes[0]?.();
        changes[0]?.();
        await waitFor(() =>
          f.received.some((event) => JSON.stringify(event.payload).includes("QUEUE_OVERFLOW")),
        );
        errors[0]?.();
        await waitFor(() => attachments >= 2);
        expect(
          f.received.some((event) => JSON.stringify(event.payload).includes("WATCH_UNAVAILABLE")),
        ).toBe(true);
        await rename(path.join(f.root, "sub"), path.join(f.root, "old-sub"));
        await mkdir(path.join(f.root, "sub"));
        await waitFor(() =>
          f.received.some((event) => JSON.stringify(event.payload).includes("DIRECTORY_REPLACED")),
        );
        await writeFile(path.join(f.root, "sub", "fresh"), "fresh");
        await waitFor(() =>
          f.received.some((event) => JSON.stringify(event.payload).includes("sub/fresh")),
        );
        expect(f.watcher.watcherCount).toBe(1);
      } finally {
        await f.close();
      }
    });
  });

  it("does not publish failed transactions and retries durable invalidation after storage recovers", async () => {
    await withTempDir(async (dir) => {
      const f = await fixture(dir);
      try {
        await writeFile(path.join(f.root, "file"), "v1");
        await f.watcher.subscribe("client", f.stream, ["file"]);
        f.opened.sqlite.exec(
          "CREATE TRIGGER fail_event BEFORE INSERT ON resource_events BEGIN SELECT RAISE(FAIL, 'fixture-storage-unavailable'); END",
        );
        await writeFile(path.join(f.root, "file"), "v2");
        await new Promise((resolve) => setTimeout(resolve, 120));
        expect(f.received).toEqual([]);
        expect(f.opened.sqlite.prepare("SELECT count(*) AS n FROM resource_events").get()).toEqual({
          n: 0,
        });
        f.opened.sqlite.exec("DROP TRIGGER fail_event");
        await waitFor(() => f.received.some((event) => event.type === "file.changed"));
        expect(f.received.some((event) => event.type === "file.resync.required")).toBe(true);
      } finally {
        await f.close();
      }
    });
  });
});

it("retains stream sequence after expiry and flags missing history instead of fabricating replay", async () => {
  await withTempDir(async (dir) => {
    const f = await fixture(dir);
    try {
      const now = Date.now();
      immediateTransaction(f.opened.db, (tx) => {
        appendResourceEvent(
          tx,
          f.stream,
          "file.changed",
          { path: "old", changeType: "modified" },
          now - 31 * 24 * 60 * 60_000,
        );
        appendResourceEvent(
          tx,
          f.stream,
          "file.changed",
          { path: "recent", changeType: "modified" },
          now,
        );
      });
      cleanupExpired(f.opened.db, now);
      const page = await listResourceEvents(
        { db: f.opened.db, dataDir: path.join(dir, "data"), now: () => now },
        { streamId: f.stream, after: 0, limit: 100 },
      );
      expect(page).toMatchObject({
        currentSequence: 2,
        resyncRequired: true,
        items: [{ sequence: 2 }],
      });
      expect(page.items).toHaveLength(1);
      cleanupExpired(f.opened.db, now + 32 * 24 * 60 * 60_000);
      const event = immediateTransaction(f.opened.db, (tx) =>
        appendResourceEvent(
          tx,
          f.stream,
          "file.changed",
          { path: "new", changeType: "created" },
          now + 32 * 24 * 60 * 60_000,
        ),
      );
      expect(event.seq).toBe(3);
    } finally {
      await f.close();
    }
  });
});

it("closes a slow resource consumer at the shared transport budget so it can replay", () => {
  let closed: number | undefined;
  let sent = false;
  send(
    {
      OPEN: 1,
      readyState: 1,
      bufferedAmount: 9 * 1024 * 1024,
      close: (code) => {
        closed = code;
      },
      send: () => {
        sent = true;
      },
    },
    { kind: "event", sequence: 1 },
  );
  expect(sent).toBe(false);
  expect(closed).toBe(1008);
});
