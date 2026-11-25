import { mkdir } from "node:fs/promises";
import path from "node:path";
import { processAlive } from "@larness/resources";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { createBrowserSession } from "../../src/db/repositories/browser-sessions.js";
import { ProcessManager } from "../../src/modules/processes/manager.js";
import { createProject } from "../../src/modules/projects/service.js";
import { updateTurnRow } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";

async function until(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe("process manager shutdown", () => {
  it("stops active background processes when the manager closes", async () => {
    await withTempDir(async (dir) => {
      const opened = openDatabase(path.join(dir, "larness.db"));
      runMigrations(opened.db);

      try {
        const dataDir = path.join(dir, "data");
        const root = path.join(dir, "project");
        await mkdir(dataDir);
        await mkdir(root);
        const project = await createProject(
          { db: opened.db, detectGit: async () => false },
          { rootPath: root },
        );
        const session = await createSession({ db: opened.db, dataDir }, { projectId: project.id });
        const now = Date.now();
        const client = createBrowserSession(opened.db, {
          tokenHash: "test-token",
          kind: "once",
          createdAt: now,
          expiresAt: now + 60_000,
        });
        const turn = createTurn(
          { db: opened.db },
          { sessionId: session.id, text: "shutdown", clientSessionId: client.id },
        );
        updateTurnRow(opened.db, turn.turnId, { status: "RUNNING" });

        const manager = new ProcessManager({ db: opened.db, dataDir, now: () => Date.now() });
        const dto = await manager.start(
          {
            sessionId: session.id,
            turnId: turn.turnId,
            toolCallId: "call_close",
            clientSessionId: client.id,
            policySnapshotId: "policy_close",
            assertAuthorized: () => {},
          },
          {
            executable: process.execPath,
            args: ["-e", "setInterval(()=>{},1000)"],
            cwd: ".",
            name: "close-fixture",
          },
        );

        expect(dto.pid).not.toBeNull();
        await manager.close();
        await until(() => !processAlive(dto.pid as number), "process exit");
      } finally {
        opened.close();
      }
    });
  });
});
