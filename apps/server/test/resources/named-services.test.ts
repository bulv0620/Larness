import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProject } from "../../src/modules/projects/service.js";
import { updateTurnRow } from "../../src/modules/sessions/repository.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe("named process services", () => {
  it("starts, deduplicates, reads logs and stops a named service", async () => {
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
          { sessionId: session.id, text: "service", clientSessionId: auth.clientSessionId },
        );
        updateTurnRow(started.running.db, turn.turnId, { status: "RUNNING" });
        const port = await freePort();
        const code = `const http=require('node:http');http.createServer((req,res)=>{res.writeHead(req.url==='/health'?200:404);res.end('ok')}).listen(${port},'127.0.0.1',()=>console.log('service-ready'))`;
        const context = {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_service",
          clientSessionId: auth.clientSessionId,
          policySnapshotId: "policy_service",
          projectId: project.id,
          assertAuthorized: () => {},
        };
        const params = {
          name: "web",
          executable: process.execPath,
          args: ["-e", code],
          cwd: ".",
          port,
          healthPath: "/health",
        };
        const service = await started.running.namedServices.start(context, params);
        expect(service).toMatchObject({
          name: "web",
          port,
          status: "RUNNING",
          previewEligible: false,
        });
        expect(service.processId).toMatch(/^prc_/);

        const again = await started.running.namedServices.start(context, params);
        expect(again.id).toBe(service.id);
        await expect(
          started.running.namedServices.start(
            { ...context, toolCallId: "call_service_other" },
            { ...params, args: ["-e", "setInterval(()=>{},1000)"] },
          ),
        ).rejects.toMatchObject({ code: "CONFLICT" });

        const logs = await started.running.namedServices.logs(
          service.id,
          {
            sessionId: session.id,
            clientSessionId: auth.clientSessionId,
            projectId: project.id,
          },
          0,
          100,
        );
        expect(logs.chunks.map((chunk) => chunk.data).join("")).toContain("service-ready");

        const listed = started.running.namedServices.list({ projectId: project.id });
        expect(listed.map((item) => item.id)).toContain(service.id);

        const stopped = await started.running.namedServices.stop(service.id, {
          sessionId: session.id,
          clientSessionId: auth.clientSessionId,
          projectId: project.id,
        });
        expect(stopped).toMatchObject({ stopped: true, service: { status: "STOPPED" } });
        const stoppedAgain = await started.running.namedServices.stop(service.id, {
          sessionId: session.id,
          clientSessionId: auth.clientSessionId,
          projectId: project.id,
        });
        expect(stoppedAgain.stopped).toBe(true);
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });

  it("rejects a port already in use before starting a second service", async () => {
    await withTempDir(async (dir) => {
      const started = await startAuthorizedServer(path.join(dir, "data"));
      const blocker = createServer();
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
          { sessionId: session.id, text: "port", clientSessionId: auth.clientSessionId },
        );
        updateTurnRow(started.running.db, turn.turnId, { status: "RUNNING" });
        const port = await new Promise<number>((resolve, reject) => {
          blocker.once("error", reject);
          blocker.listen(0, "127.0.0.1", () => {
            const address = blocker.address();
            resolve(typeof address === "object" && address !== null ? address.port : 0);
          });
        });
        const context = {
          sessionId: session.id,
          turnId: turn.turnId,
          toolCallId: "call_port",
          clientSessionId: auth.clientSessionId,
          policySnapshotId: "policy_service",
          projectId: project.id,
          assertAuthorized: () => {},
        };
        await expect(
          started.running.namedServices.start(context, {
            name: "blocked",
            executable: process.execPath,
            args: ["-e", "setInterval(()=>{},1000)"],
            cwd: ".",
            port,
          }),
        ).rejects.toMatchObject({ code: "CONFLICT" });
      } finally {
        await new Promise<void>((resolve) => blocker.close(() => resolve()));
        await stopAuthorizedServer(started);
      }
    });
  });
});
