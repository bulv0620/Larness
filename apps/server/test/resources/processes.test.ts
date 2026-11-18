import { mkdir } from "node:fs/promises";
import path from "node:path";
import { processAlive } from "@larness/resources";
import { describe, expect, it } from "vitest";
import { createProject } from "../../src/modules/projects/service.js";
import { updateTurnRow } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { getFreePort, withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

async function until(check: () => boolean | Promise<boolean>, label: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

describe("background process manager", () => {
  it("starts, reads, deduplicates and stops a real process group", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const project = await createProject(
          { db: started.running.db, detectGit: async () => false },
          { rootPath: root },
        );
        const session = await createSession(
          { db: started.running.db, dataDir: started.running.dataDir },
          { projectId: project.id },
        );
        const auth = (
          await started.running.app.inject({
            url: "/api/auth/session",
            headers: { cookie: started.cookie },
          })
        ).json() as { clientSessionId: string };
        const turn = createTurn(
          { db: started.running.db },
          { sessionId: session.id, text: "background", clientSessionId: auth.clientSessionId },
        );
        updateTurnRow(started.running.db, turn.turnId, { status: "RUNNING" });
        const context = {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_process",
          clientSessionId: auth.clientSessionId,
          policySnapshotId: "policy_process",
          assertAuthorized: () => {},
        };
        const params = {
          executable: process.execPath,
          args: [
            "-e",
            "console.log('process-ready');console.error('process-warn');setInterval(()=>{},1000)",
          ],
          cwd: ".",
          name: "fixture",
        };

        const first = await started.running.processes.start(context, params);
        expect(first).toMatchObject({
          status: "RUNNING",
          name: "fixture",
          cwd: ".",
          exitCode: null,
        });
        expect(first.pid).not.toBeNull();

        const again = await started.running.processes.start(context, params);
        expect(again.id).toBe(first.id);

        await until(async () => {
          const page = await started.running.processes.readOutput(
            first.id,
            {
              sessionId: session.id,
              clientSessionId: auth.clientSessionId,
              projectId: project.id,
            },
            0,
            100,
          );
          const text = page.chunks.map((chunk) => chunk.data).join("");
          return text.includes("process-ready") && text.includes("process-warn");
        }, "process output");
        const page = await started.running.processes.readOutput(
          first.id,
          {
            sessionId: session.id,
            clientSessionId: auth.clientSessionId,
            projectId: project.id,
          },
          0,
          100,
        );
        expect(page.chunks.map((chunk) => chunk.data).join("")).toContain("process-warn");
        expect(page.nextCursor).toBeGreaterThan(0);

        await expect(
          started.running.processes.start(
            { ...context, toolCallId: "call_process_other" },
            { ...params, args: ["-e", "setInterval(()=>{},1000)"] },
          ),
        ).rejects.toMatchObject({ code: "CONFLICT" });

        const stopped = await started.running.processes.stop(first.id, {
          sessionId: session.id,
          clientSessionId: auth.clientSessionId,
          projectId: project.id,
        });
        expect(stopped).toMatchObject({ stopped: true, process: { status: "STOPPED" } });
        if (first.pid !== null) {
          await until(() => !processAlive(first.pid as number), "process exit");
        }
        const stoppedAgain = await started.running.processes.stop(first.id, {
          sessionId: session.id,
          clientSessionId: auth.clientSessionId,
          projectId: project.id,
        });
        expect(stoppedAgain.stopped).toBe(true);

        const listed = await started.running.app.inject({
          url: `/api/processes?projectId=${project.id}`,
          headers: { cookie: started.cookie },
        });
        expect(listed.statusCode).toBe(200);
        expect(listed.json()).toMatchObject({ items: [] });
        const output = await started.running.app.inject({
          url: `/api/processes/${first.id}/output?after=0`,
          headers: { cookie: started.cookie },
        });
        expect(output.statusCode).toBe(200);
        expect(output.json().chunks.length).toBeGreaterThan(0);
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("reports an immediate exit with its tail and rejects interactive commands", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const project = await createProject(
          { db: started.running.db, detectGit: async () => false },
          { rootPath: root },
        );
        const session = await createSession(
          { db: started.running.db, dataDir: started.running.dataDir },
          { projectId: project.id },
        );
        const auth = (
          await started.running.app.inject({
            url: "/api/auth/session",
            headers: { cookie: started.cookie },
          })
        ).json() as { clientSessionId: string };
        const turn = createTurn(
          { db: started.running.db },
          { sessionId: session.id, text: "exit", clientSessionId: auth.clientSessionId },
        );
        updateTurnRow(started.running.db, turn.turnId, { status: "RUNNING" });
        const context = {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_exit",
          clientSessionId: auth.clientSessionId,
          policySnapshotId: "policy_process",
          assertAuthorized: () => {},
        };
        const exited = await started.running.processes.start(context, {
          executable: process.execPath,
          args: ["-e", "console.log('boom');process.exit(2)"],
          cwd: ".",
        });
        await until(
          () =>
            ["EXITED", "FAILED", "STOPPED"].includes(
              started.running.processes.get(exited.id).status,
            ),
          "immediate exit",
        );
        const dto = started.running.processes.get(exited.id);
        expect(dto).toMatchObject({ status: "FAILED", exitCode: 2, reasonCode: "NONZERO_EXIT" });
        expect(
          started.running.processes.list({ projectId: project.id }).map((item) => item.id),
        ).not.toContain(exited.id);
        const page = await started.running.processes.readOutput(
          exited.id,
          {
            sessionId: session.id,
            clientSessionId: auth.clientSessionId,
            projectId: project.id,
          },
          0,
          100,
        );
        expect(page.chunks.map((chunk) => chunk.data).join("")).toContain("boom");

        await expect(
          started.running.processes.start(
            { ...context, toolCallId: "call_interactive" },
            { executable: "vim", args: [], cwd: "." },
          ),
        ).rejects.toMatchObject({ code: "INTERACTIVE_COMMAND" });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("exposes a declared port for lazy preview and drops eligibility on stop", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      try {
        const root = path.join(dir, "project");
        await mkdir(root);
        const project = await createProject(
          { db: started.running.db, detectGit: async () => false },
          { rootPath: root },
        );
        const session = await createSession(
          { db: started.running.db, dataDir: started.running.dataDir },
          { projectId: project.id },
        );
        const auth = (
          await started.running.app.inject({
            url: "/api/auth/session",
            headers: { cookie: started.cookie },
          })
        ).json() as { clientSessionId: string };
        const turn = createTurn(
          { db: started.running.db },
          { sessionId: session.id, text: "preview", clientSessionId: auth.clientSessionId },
        );
        updateTurnRow(started.running.db, turn.turnId, { status: "RUNNING" });
        const context = {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_preview",
          clientSessionId: auth.clientSessionId,
          policySnapshotId: "policy_preview",
          assertAuthorized: () => {},
        };
        const port = await getFreePort();
        const code = `const http=require('node:http');http.createServer((req,res)=>res.end('ok')).listen(${port},'127.0.0.1',()=>console.log('preview-ready'))`;
        const dto = await started.running.processes.start(context, {
          executable: process.execPath,
          args: ["-e", code],
          cwd: ".",
          name: "preview",
          port,
          healthPath: "/",
        });
        expect(dto).toMatchObject({ port, status: "RUNNING", previewEligible: true });
        await until(async () => {
          try {
            const target = await started.running.processes.verifyPreview(dto.id);
            return target.port === port;
          } catch {
            return false;
          }
        }, "preview target");
        const target = await started.running.processes.verifyPreview(dto.id);
        expect(target).toEqual({ id: dto.id, projectId: project.id, host: "127.0.0.1", port });
        const listed = started.running.processes.list({ projectId: project.id });
        expect(listed.map((item) => item.id)).toContain(dto.id);

        await started.running.processes.stop(dto.id, {
          sessionId: session.id,
          clientSessionId: auth.clientSessionId,
          projectId: project.id,
        });
        expect(started.running.processes.get(dto.id)).toMatchObject({
          status: "STOPPED",
          previewEligible: false,
        });
        expect(started.running.processes.list({ projectId: project.id })).toEqual([]);
        await expect(started.running.processes.verifyPreview(dto.id)).rejects.toMatchObject({
          code: "PREVIEW_UNAVAILABLE",
        });
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
