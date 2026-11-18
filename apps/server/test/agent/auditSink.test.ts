import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { AuditSink } from "../../src/modules/audit/sink.js";
import { withTempDir } from "../helpers.js";

describe("audit sink levels", () => {
  it("fails closed when a required audit cannot be written", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "test.db"));
      runMigrations(opened.db);
      try {
        opened.sqlite.exec(
          "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'fixture'); END",
        );
        const sink = new AuditSink({ db: opened.db });
        expect(() => sink.required({ action: "tool.denied", decision: "deny" })).toThrow(
          expect.objectContaining({ code: "RESOURCE_UNAVAILABLE" }),
        );
      } finally {
        opened.close();
      }
    });
  });

  it("writes resource audits but keeps debug entries out of the audit table", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "test.db"));
      runMigrations(opened.db);
      try {
        const sink = new AuditSink({ db: opened.db });
        sink.resource({ action: "file.saved", decision: "allow" });
        sink.debug({ action: "tool.completed", decision: "allow" });
        const rows = opened.sqlite
          .prepare("SELECT action FROM audit_logs ORDER BY created_at")
          .all() as { action: string }[];
        expect(rows.map((row) => row.action)).toEqual(["file.saved"]);
      } finally {
        opened.close();
      }
    });
  });
});
