import path from "node:path";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  acquireResourceLock,
  findResourceLock,
  getActiveResourceLock,
  releaseResourceLock,
  renewResourceLock,
} from "../../src/modules/locks/service.js";
import { withTempDir } from "../helpers.js";

async function openWorkspace(dir: string): Promise<OpenedDatabase> {
  const opened = openDatabase(path.join(dir, "larness.db"));
  runMigrations(opened.db);
  return opened;
}

describe("resource locks", () => {
  it("grants one lock per resource and enforces fencing on renew and release", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const options = { db: opened.db, now: () => clock.value };
        const input = {
          resourceType: "project" as const,
          resourceId: "prj_1",
          owner: "ses_1",
          executionId: "trn_1",
          ttlMs: 1_000,
        };
        const first = acquireResourceLock(options, input);

        expect(first).toMatchObject({
          resourceType: "project",
          resourceId: "prj_1",
          owner: "ses_1",
          executionId: "trn_1",
          fencingToken: 1,
          expiresAt: 2_000,
          heartbeatAt: 1_000,
        });

        clock.value = 1_500;
        expect(acquireResourceLock(options, { ...input, owner: "ses_2" })).toBeNull();

        const renewed = renewResourceLock(options, {
          id: first?.id ?? "",
          fencingToken: first?.fencingToken ?? 0,
          ttlMs: 1_000,
        });
        expect(renewed).toMatchObject({ expiresAt: 2_500, heartbeatAt: 1_500 });
        expect(
          renewResourceLock(options, {
            id: first?.id ?? "",
            fencingToken: 999,
            ttlMs: 1_000,
          }),
        ).toBeNull();

        expect(releaseResourceLock(options, { id: first?.id ?? "", fencingToken: 999 })).toBe(
          false,
        );
        expect(
          releaseResourceLock(options, {
            id: first?.id ?? "",
            fencingToken: first?.fencingToken ?? 0,
          }),
        ).toBe(true);
        expect(getActiveResourceLock(opened.db, "project", "prj_1", 1_600)).toBeNull();
        expect(findResourceLock(opened.db, "project", "prj_1")).toMatchObject({
          fencingToken: 1,
          expiresAt: 0,
        });

        clock.value = 1_600;
        const next = acquireResourceLock(options, { ...input, owner: "ses_3" });
        expect(next).toMatchObject({ owner: "ses_3", fencingToken: 2, expiresAt: 2_600 });
        expect(
          renewResourceLock(options, {
            id: first?.id ?? "",
            fencingToken: first?.fencingToken ?? 0,
            ttlMs: 1_000,
          }),
        ).toBeNull();
      } finally {
        opened.close();
      }
    });
  });

  it("reclaims an expired lock with a higher fencing token", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const options = { db: opened.db, now: () => clock.value };
        const first = acquireResourceLock(options, {
          resourceType: "project",
          resourceId: "prj_1",
          owner: "ses_1",
          executionId: "trn_1",
          ttlMs: 100,
        });
        expect(first?.expiresAt).toBe(1_100);

        clock.value = 1_200;
        const reclaimed = acquireResourceLock(options, {
          resourceType: "project",
          resourceId: "prj_1",
          owner: "ses_2",
          executionId: "trn_2",
          ttlMs: 500,
        });
        expect(reclaimed).toMatchObject({ owner: "ses_2", fencingToken: 2, expiresAt: 1_700 });
        expect(
          renewResourceLock(options, {
            id: first?.id ?? "",
            fencingToken: first?.fencingToken ?? 0,
            ttlMs: 500,
          }),
        ).toBeNull();
      } finally {
        opened.close();
      }
    });
  });

  it("revives an expired lease while its fencing owner is unchanged", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const options = { db: opened.db, now: () => clock.value };
        const first = acquireResourceLock(options, {
          resourceType: "project",
          resourceId: "prj_1",
          owner: "ses_1",
          executionId: "trn_1",
          ttlMs: 100,
        });
        expect(first).toMatchObject({ fencingToken: 1, expiresAt: 1_100 });

        clock.value = 1_200;
        expect(
          renewResourceLock(options, {
            id: first?.id ?? "",
            fencingToken: first?.fencingToken ?? 0,
            ttlMs: 100,
          }),
        ).toMatchObject({ fencingToken: 1, expiresAt: 1_300, heartbeatAt: 1_200 });

        clock.value = 1_400;
        expect(
          renewResourceLock(options, {
            id: first?.id ?? "",
            fencingToken: 999,
            ttlMs: 100,
          }),
        ).toBeNull();
      } finally {
        opened.close();
      }
    });
  });

  it("refuses to revive an expired lease once another writer owns the root", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const options = { db: opened.db, now: () => clock.value };
        const first = acquireResourceLock(options, {
          resourceType: "project",
          resourceId: "prj_1",
          owner: "ses_1",
          executionId: "trn_1",
          ttlMs: 100,
          rootRealPath: "/repo",
        });
        expect(first?.expiresAt).toBe(1_100);

        clock.value = 1_200;
        const second = acquireResourceLock(options, {
          resourceType: "project",
          resourceId: "prj_2",
          owner: "ses_2",
          executionId: "trn_2",
          ttlMs: 1_000,
          rootRealPath: "/repo",
        });
        expect(second).not.toBeNull();
        expect(
          renewResourceLock(options, {
            id: first?.id ?? "",
            fencingToken: first?.fencingToken ?? 0,
            ttlMs: 100,
          }),
        ).toBeNull();

        expect(
          releaseResourceLock(options, {
            id: second?.id ?? "",
            fencingToken: second?.fencingToken ?? 0,
          }),
        ).toBe(true);
        expect(
          renewResourceLock(options, {
            id: first?.id ?? "",
            fencingToken: first?.fencingToken ?? 0,
            ttlMs: 100,
          }),
        ).toMatchObject({ fencingToken: 1, expiresAt: 1_300 });
      } finally {
        opened.close();
      }
    });
  });

  it("ignores its own in-flight operation but not a reconciliation barrier", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const clock = { value: 1_000 };
        const options = { db: opened.db, now: () => clock.value };
        const first = acquireResourceLock(options, {
          resourceType: "project",
          resourceId: "prj_1",
          owner: "ses_1",
          executionId: "trn_1",
          ttlMs: 100,
          rootRealPath: "/repo",
        });
        opened.sqlite
          .prepare(
            `INSERT INTO resource_operations
             (id, scope_key, root_real_path, kind, status, params_hash, idempotency_key,
              client_session_id, path, expected_version, target_version, lock_id,
              fencing_token, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            "rop_test",
            "project:prj_1",
            "/repo",
            "command.run",
            "WRITING",
            "hash",
            "key",
            "client",
            ".",
            "",
            "",
            first?.id ?? "",
            first?.fencingToken ?? 0,
            1_000,
            1_000,
          );

        clock.value = 1_200;
        expect(
          renewResourceLock(options, {
            id: first?.id ?? "",
            fencingToken: first?.fencingToken ?? 0,
            ttlMs: 100,
          }),
        ).toMatchObject({ fencingToken: 1, expiresAt: 1_300 });

        opened.sqlite
          .prepare("UPDATE resource_operations SET status = ? WHERE id = ?")
          .run("RECONCILIATION_REQUIRED", "rop_test");
        clock.value = 1_400;
        expect(
          renewResourceLock(options, {
            id: first?.id ?? "",
            fencingToken: first?.fencingToken ?? 0,
            ttlMs: 100,
          }),
        ).toBeNull();
      } finally {
        opened.close();
      }
    });
  });

  it("locks different resources independently and validates input", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const options = { db: opened.db, now: () => 1_000 };
        const base = {
          resourceType: "project" as const,
          owner: "ses_1",
          executionId: "trn_1",
          ttlMs: 1_000,
        };

        const first = acquireResourceLock(options, { ...base, resourceId: "prj_1" });
        const second = acquireResourceLock(options, { ...base, resourceId: "prj_2" });
        expect(first?.fencingToken).toBe(1);
        expect(second?.fencingToken).toBe(1);

        expect(() =>
          acquireResourceLock(options, { ...base, resourceId: "prj_3", ttlMs: 0 }),
        ).toThrow(/ttlMs/);
        expect(() => acquireResourceLock(options, { ...base, resourceId: "   " })).toThrow(
          /resourceId/,
        );
      } finally {
        opened.close();
      }
    });
  });
});
