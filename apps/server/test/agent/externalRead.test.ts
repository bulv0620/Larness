import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFakeProvider, createFileToolRegistry, type ProviderChunk } from "@larness/agent";
import { describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { createProject } from "../../src/modules/projects/service.js";
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
      { type: "finish", finishReason: "stop" },
    ],
  };
}

describe("external reads in a turn", () => {
  it("reads outside the project but keeps the data directory gated", async () => {
    await withTempDir(async (dir) => {
      const opened = await openWorkspace(dir);

      try {
        const root = path.join(dir, "project");
        const reference = path.join(dir, "reference");
        const dataDir = path.join(dir, "data");
        await mkdir(root);
        await mkdir(reference);
        await mkdir(dataDir);
        await writeFile(path.join(reference, "api.md"), "# api\n");
        await writeFile(path.join(dataDir, "master.key"), "k");
        const realReference = await realpath(reference);
        const realDataDir = await realpath(dataDir);

        const project = await createProject(
          { db: opened.db, detectGit: async () => false },
          { rootPath: root },
        );
        const options = { db: opened.db, dataDir };
        const session = await createSession(options, { projectId: project.id });
        const turn = createTurn(options, { sessionId: session.id, text: "read outside" });
        const provider = createFakeProvider([
          {
            chunks: [
              {
                type: "tool-call",
                toolCall: {
                  id: "external",
                  name: "read_file",
                  args: { path: path.join(realReference, "api.md") },
                },
              },
              {
                type: "tool-call",
                toolCall: {
                  id: "gated",
                  name: "read_file",
                  args: { path: path.join(realDataDir, "master.key") },
                },
              },
              { type: "finish", finishReason: "tool-calls" },
            ],
          },
          textStep("done"),
        ]);
        const runner = new TurnRunner({
          db: opened.db,
          dataDir,
          registry: createFileToolRegistry(),
          resolveProvider: () => ({ adapter: provider, model: "fake" }),
        });

        expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");

        const toolOutput = (provider.calls[1]?.messages ?? [])
          .filter((message) => message.role === "tool")
          .map((message) => String(message.content ?? ""))
          .join("\n");
        expect(toolOutput).toContain("# api");
        expect(toolOutput).toContain("FORBIDDEN");
      } finally {
        opened.close();
      }
    });
  });
});
