import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { ProjectLockError, ProjectWriteLock } from "../../src/modules/agent/projectWriteLock.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

describe("ProjectWriteLock", () => {
  it("serializes project writers, renews leases and rejects stale fences", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const now = () => clock.value;
        const first = new ProjectWriteLock({
          db: opened.db,
          projectId: "prj_1",
          owner: "ses_1",
          executionId: "trn_1",
          ttlMs: 1_000,
          now,
        });
        const second = new ProjectWriteLock({
          db: opened.db,
          projectId: "prj_1",
          owner: "ses_2",
          executionId: "trn_2",
          ttlMs: 1_000,
          now,
        });

        const handle = first.acquire();
        expect(handle).toMatchObject({ fencingToken: 1, expiresAt: 2_000 });
        expect(second.acquire()).toBeNull();
        expect(first.assertHeld().fencingToken).toBe(1);

        clock.value = 1_500;
        expect(first.renew()).toMatchObject({ expiresAt: 2_500 });
        expect(second.acquire()).toBeNull();

        clock.value = 3_000;
        const reclaimed = second.acquire();
        expect(reclaimed).toMatchObject({ fencingToken: 2, expiresAt: 4_000 });
        expect(() => first.assertHeld()).toThrowError(ProjectLockError);
        expect(first.renew()).toBeNull();
        expect(first.release()).toBe(false);

        expect(second.release()).toBe(true);
        expect(second.current()).toBeNull();

        const third = new ProjectWriteLock({
          db: opened.db,
          projectId: "prj_1",
          owner: "ses_3",
          executionId: "trn_3",
          ttlMs: 1_000,
          now,
        });
        expect(third.acquire()).toMatchObject({ fencingToken: 3 });
        expect(third.release()).toBe(true);
      } finally {
        opened.close();
      }
    });
  });

  it("revives an expired lease it still owns and reports a takeover as lost", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const now = () => clock.value;
        const first = new ProjectWriteLock({
          db: opened.db,
          projectId: "prj_1",
          owner: "ses_1",
          executionId: "trn_1",
          ttlMs: 1_000,
          now,
        });
        const second = new ProjectWriteLock({
          db: opened.db,
          projectId: "prj_1",
          owner: "ses_2",
          executionId: "trn_2",
          ttlMs: 1_000,
          now,
        });

        expect(first.acquire()).toMatchObject({ fencingToken: 1, expiresAt: 2_000 });

        clock.value = 5_000;
        expect(first.renew()).toMatchObject({ fencingToken: 1, expiresAt: 6_000 });
        expect(first.lost).toBe(false);
        expect(second.acquire()).toBeNull();

        clock.value = 7_000;
        expect(first.acquire()).toMatchObject({ fencingToken: 1, expiresAt: 8_000 });
        expect(second.acquire()).toBeNull();

        clock.value = 9_000;
        expect(second.acquire()).toMatchObject({ fencingToken: 2, expiresAt: 10_000 });
        expect(first.renew()).toBeNull();
        expect(first.lost).toBe(true);
        expect(first.acquire()).toBeNull();
        expect(first.release()).toBe(false);

        const never = new ProjectWriteLock({
          db: opened.db,
          projectId: "prj_1",
          owner: "ses_3",
          executionId: "trn_3",
          ttlMs: 1_000,
          now,
        });
        expect(never.acquire()).toBeNull();
        expect(never.lost).toBe(false);
        expect(never.renewIfHeld()).toBe(true);

        expect(second.release()).toBe(true);
        expect(never.acquire()).toMatchObject({ fencingToken: 3 });
        expect(never.release()).toBe(true);
      } finally {
        opened.close();
      }
    });
  });
});
