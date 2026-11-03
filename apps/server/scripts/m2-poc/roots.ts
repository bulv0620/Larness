import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { isInsideRoot } from "@larness/resources";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { immediateTransaction } from "../../src/db/transaction.js";
import {
  acquireResourceLock,
  getActiveResourceLock,
  type ResourceLockHandle,
  releaseResourceLock,
  renewResourceLock,
} from "../../src/modules/locks/service.js";
import { processTree, temporary } from "./system.js";

// Persistent root mapping / stop confirmation, only inside a disposable PoC DB.
// M2-1 must integrate this protocol with resource_operations and all writers.
class RootCoordinator {
  constructor(
    readonly opened: OpenedDatabase,
    readonly now: () => number,
  ) {
    opened.sqlite.exec(`CREATE TABLE IF NOT EXISTS m2_poc_writers (
      root TEXT PRIMARY KEY, stopped INTEGER NOT NULL, process_identity TEXT NOT NULL,
      fence INTEGER NOT NULL)`);
  }
  acquire(root: string, executionId: string) {
    return immediateTransaction(this.opened.db, () => {
      const rows = this.opened.sqlite
        .prepare("SELECT root FROM m2_poc_writers WHERE stopped = 0")
        .all() as { root: string }[];
      if (rows.some((row) => isInsideRoot(row.root, root) || isInsideRoot(root, row.root)))
        return null;
      const handle = acquireResourceLock(
        { db: this.opened.db, now: this.now },
        {
          resourceType: "project",
          resourceId: root,
          owner: "poc",
          executionId,
          ttlMs: 100,
        },
      );
      if (handle)
        this.opened.sqlite
          .prepare("INSERT OR REPLACE INTO m2_poc_writers VALUES (?, 0, '', ?)")
          .run(root, handle.fencingToken);
      return handle;
    });
  }
  confirmedStopped(handle: ResourceLockHandle) {
    return (
      this.opened.sqlite
        .prepare("UPDATE m2_poc_writers SET stopped = 1 WHERE root = ? AND fence = ?")
        .run(handle.resourceId, handle.fencingToken).changes === 1
    );
  }
  assertWritable(handle: ResourceLockHandle) {
    const current = getActiveResourceLock(this.opened.db, "project", handle.resourceId, this.now());
    assert(
      current &&
        current.fencingToken === handle.fencingToken &&
        current.executionId === handle.executionId,
      "STALE_FENCE",
    );
  }
}

export async function probeRoots(migrations?: string) {
  return temporary(async (directory) => {
    const root = await realpath(directory);
    const project = path.join(root, "project");
    const nested = path.join(project, "nested");
    const independent = path.join(root, "sessions", "independent", "workspace");
    const global = path.join(root, "sessions", "global-terminal", "workspace");
    for (const item of [nested, independent, global]) await mkdir(item, { recursive: true });
    let clock = 1_000;
    const dbPath = path.join(root, "probe.db");
    let opened = openDatabase(dbPath);
    const tree = await processTree(root);
    try {
      runMigrations(opened.db, migrations);
      let coordinator = new RootCoordinator(opened, () => clock);
      const old = coordinator.acquire(project, "old");
      assert(old);
      opened.sqlite
        .prepare("UPDATE m2_poc_writers SET process_identity = ? WHERE root = ?")
        .run(tree.original, project);
      assert.equal(coordinator.acquire(project, "same-root-other-id"), null);
      assert.equal(coordinator.acquire(nested, "nested-project"), null);
      assert.equal(coordinator.acquire(root, "ancestor"), null);
      assert(coordinator.acquire(independent, "independent"));
      assert(coordinator.acquire(global, "global"));
      assert(coordinator.acquire(path.join(root, "project-sibling"), "prefix-sibling"));
      assert.equal(coordinator.acquire(path.join(root, "sessions"), "workspace-ancestor"), null);
      clock = 2_000;
      assert.equal(
        renewResourceLock(
          { db: opened.db, now: () => clock },
          {
            id: old.id,
            fencingToken: old.fencingToken,
            ttlMs: 100,
          },
        ),
        null,
      );
      assert.equal(coordinator.acquire(nested, "expired-but-writing"), null);
      assert.throws(() => coordinator.assertWritable(old), /STALE_FENCE/);
      opened.close();
      opened = openDatabase(dbPath);
      coordinator = new RootCoordinator(opened, () => clock);
      assert.equal(coordinator.acquire(project, "after-restart"), null);
      const persisted = opened.sqlite
        .prepare("SELECT process_identity FROM m2_poc_writers WHERE root = ?")
        .get(project) as { process_identity: string };
      assert.equal(persisted.process_identity, tree.original);
      assert.equal(await tree.stop("wrong-start-identity"), false);
      assert.equal(coordinator.acquire(project, "identity-unknown"), null);
      assert.equal(await tree.stop(persisted.process_identity), true);
      assert(coordinator.confirmedStopped(old));
      const fresh = coordinator.acquire(project, "fresh");
      assert(fresh);
      assert(fresh.fencingToken > old.fencingToken);
      coordinator.assertWritable(fresh);
      assert.throws(() => coordinator.assertWritable(old), /STALE_FENCE/);
      assert.equal(coordinator.confirmedStopped(old), false);
      assert.equal(releaseResourceLock({ db: opened.db }, old), false);
      assert.equal(renewResourceLock({ db: opened.db }, { ...old, ttlMs: 100 }), null);
      return { overlap: true, disjoint: true, restartBlocked: true, staleFenceRejected: true };
    } finally {
      await tree.stop();
      opened.close();
    }
  });
}
