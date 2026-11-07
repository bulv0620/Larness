import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createFakeProvider, type ProviderAdapter } from "@larness/agent";
import { Pm2CommandContextSchema, type ServiceOpsServiceDto } from "@larness/shared";
import { describe, expect, it } from "vitest";
import { acquireResourceLock, releaseResourceLock } from "../../src/modules/locks/service.js";
import { createProject } from "../../src/modules/projects/service.js";
import { Pm2Adapter } from "../../src/modules/service-ops/pm2.js";
import { getFreePort, withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

const buildScript = `
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const [root, name, port] = process.argv.slice(2);
await mkdir(root, { recursive: true });
await mkdir(path.join(process.cwd(), ".pm2"), { recursive: true });
await writeFile(path.join(root, "server.cjs"), 'require("node:http").createServer((req,res)=>res.end(' + JSON.stringify(name) + ')).listen(' + port + ',"127.0.0.1",()=>console.log("ready"));');
await writeFile(path.join(root, "ecosystem.config.cjs"), "module.exports=" + JSON.stringify({ apps: [{ name, namespace: "larness", script: path.join(root,"server.cjs"), cwd: root, out_file: path.join(process.cwd(), ".pm2", "out.log") }] }));
`;

describe.skipIf(process.env.LARNESS_POC_PM2 !== "1")("PM2 command deployment", () => {
  it("deploys from ordinary project conversations and reconciles project-qualified service names", async () => {
    await withTempDir(async (dir) => {
      const ports = [await getFreePort(), await getFreePort()];
      const usedNames: string[] = [];
      const provider: ProviderAdapter = {
        ...createFakeProvider([]),
        async *streamStep(input) {
          const line = input.messages[0]?.content
            .split("\n")
            .find((value) => value.startsWith("PM2 runtime and service/project associations: "));
          if (!line) throw new Error("missing PM2 system context");
          const context = Pm2CommandContextSchema.parse(
            JSON.parse(line.slice(line.indexOf(": ") + 2)),
          );
          if (!context.project || !context.entry)
            throw new Error("missing registered project or PM2");
          expect(input.tools.map(({ name }) => name)).toContain("run_command");
          expect(input.tools.map(({ name }) => name)).not.toContain("start_formal_service");
          const project = context.project;
          const name = `larness:${project.id}:api`;
          const index = usedNames.includes(name)
            ? usedNames.indexOf(name)
            : usedNames.push(name) - 1;
          const currentInput = input.messages.filter(({ role }) => role === "user").at(-1)?.content;
          const results = input.messages.filter(({ role }) => role === "tool");
          const count = results.length;
          if (currentInput === "deploy api again" && count === 0) {
            expect(context.services.some((service) => service.pm2Name === name)).toBe(false);
          }
          const prior = results.at(-1);
          if (prior?.role === "tool" && prior.isError)
            throw new Error(`command failed: ${prior.content}`);
          if (count >= (currentInput === "stop" || currentInput === "delete" ? 1 : 3)) {
            yield { type: "text-delta", text: "Verified CLI result" };
          } else {
            const args =
              currentInput === "stop" || currentInput === "delete"
                ? [context.entry, currentInput, name]
                : count === 0
                  ? ["build.mjs", project.releaseRoot, name, String(ports[index])]
                  : count === 1
                    ? [
                        context.entry,
                        "start",
                        path.join(project.releaseRoot, "ecosystem.config.cjs"),
                        "--only",
                        name,
                      ]
                    : [
                        "-e",
                        `fetch('http://127.0.0.1:${ports[index]}').then(r=>r.text()).then(console.log)`,
                      ];
            yield {
              type: "tool-call",
              toolCall: {
                id: `step_${count}`,
                name: "run_command",
                args: { executable: context.nodeExecutable, args, timeoutMs: 15_000 },
              },
            };
          }
          yield { type: "finish", finishReason: "stop" };
        },
      };
      const started = await startAuthorizedServer(path.join(dir, "data"), {
        turnRunner: true,
        providerResolver: () => ({ adapter: provider, model: "fake" }),
        env: { LARNESS_PM2_AUTO_INSTALL: "1", LARNESS_PM2_PREFIX: path.join(dir, "global") },
      });
      let stopped = false;
      try {
        const auth = {
          cookie: started.cookie,
          origin: started.origin,
          "x-csrf-token": started.csrf,
        };
        const sessions: { id: string; projectId: string }[] = [];
        const waitTurn = async (turnId: string) => {
          await expect
            .poll(
              () =>
                started.running.sqlite.prepare("SELECT status FROM turns WHERE id = ?").get(turnId),
              { timeout: 15_000 },
            )
            .toEqual({ status: "COMPLETED" });
        };
        for (const label of ["one", "two"]) {
          const root = path.join(dir, label);
          await mkdir(root);
          await writeFile(path.join(root, "build.mjs"), buildScript);
          const project = await createProject(
            { db: started.running.db, detectGit: async () => false },
            { rootPath: root },
          );
          const created = await started.running.app.inject({
            method: "POST",
            url: "/api/sessions",
            headers: auth,
            payload: { projectId: project.id },
          });
          const session = created.json<{ id: string }>();
          sessions.push({ id: session.id, projectId: project.id });
          await started.running.app.inject({
            method: "PATCH",
            url: `/api/sessions/${session.id}`,
            headers: auth,
            payload: { approvalPolicyId: "autonomous" },
          });
          const turn = await started.running.app.inject({
            method: "POST",
            url: `/api/sessions/${session.id}/turns`,
            headers: auth,
            payload: { input: "deploy api" },
          });
          expect(turn.statusCode, turn.body).toBe(202);
          await waitTurn(turn.json<{ turnId: string }>().turnId);
        }
        const response = await started.running.app.inject({
          url: "/api/service-ops/services",
          headers: auth,
        });
        const services = response.json<{ items: ServiceOpsServiceDto[] }>().items;
        expect(services).toHaveLength(2);
        for (const session of sessions) {
          expect(services.find((service) => service.projectId === session.projectId)).toMatchObject(
            {
              pm2Name: `larness:${session.projectId}:api`,
              observedState: "running",
              source: "pm2-cli",
              lastHealthAt: null,
            },
          );
        }
        const log = await started.running.app.inject({
          url: `/api/service-ops/services/${services[0]?.targetId}/logs`,
          headers: auth,
        });
        expect(log.statusCode, log.body).toBe(200);
        expect(log.json<{ text: string }>().text).toContain("ready");
        const controlled = services.find((service) => service.projectId === sessions[1]?.projectId);
        if (!controlled) throw new Error("missing controlled service");
        const controlUrl = `/api/service-ops/services/${controlled.targetId}/control`;
        const controlPayload = {
          action: "stop",
          requestKey: "unauthorized",
          expectedPm2Name: controlled.pm2Name,
          confirmed: true,
        };
        expect(
          (
            await started.running.app.inject({
              method: "POST",
              url: controlUrl,
              headers: { origin: started.origin },
              payload: controlPayload,
            })
          ).statusCode,
        ).toBe(401);
        expect(
          (
            await started.running.app.inject({
              method: "POST",
              url: controlUrl,
              headers: { cookie: started.cookie, origin: started.origin },
              payload: controlPayload,
            })
          ).statusCode,
        ).toBe(403);
        expect(
          (
            await started.running.app.inject({
              method: "POST",
              url: controlUrl,
              headers: auth,
              payload: { ...controlPayload, confirmed: false },
            })
          ).statusCode,
        ).toBe(400);
        const control = (
          action: "start" | "stop" | "restart",
          requestKey: string,
          expectedPm2Name = controlled.pm2Name,
        ) =>
          started.running.app.inject({
            method: "POST",
            url: `/api/service-ops/services/${controlled.targetId}/control`,
            headers: auth,
            payload: { action, requestKey, expectedPm2Name, confirmed: true },
          });
        expect((await control("stop", "wrong-name", "another-service")).statusCode).toBe(409);
        const lock = acquireResourceLock(
          { db: started.running.db },
          {
            resourceType: "project",
            resourceId: controlled.projectId,
            owner: "test",
            executionId: "test-control",
            ttlMs: 60_000,
          },
        );
        if (!lock) throw new Error("missing test lock");
        try {
          expect((await control("stop", "locked")).statusCode).toBe(409);
        } finally {
          releaseResourceLock({ db: started.running.db }, lock);
        }
        const stoppedService = await control("stop", "human-stop");
        expect(stoppedService.statusCode, stoppedService.body).toBe(200);
        expect(stoppedService.json()).toMatchObject({ observedState: "stopped", pid: null });
        const startedService = await control("start", "human-start");
        expect(startedService.statusCode, startedService.body).toBe(200);
        expect(startedService.json()).toMatchObject({
          observedState: "running",
          lastHealthAt: null,
        });
        const restarted = await control("restart", "human-restart");
        expect(restarted.statusCode, restarted.body).toBe(200);
        expect(restarted.json<{ pid: number }>().pid).not.toBe(
          startedService.json<{ pid: number }>().pid,
        );
        const repeated = await control("restart", "human-restart");
        expect(repeated.json<{ pid: number }>().pid).toBe(restarted.json<{ pid: number }>().pid);
        expect((await control("stop", "human-restart")).statusCode).toBe(409);
        // Crash after a PM2 side effect but before committing its result: never replay it.
        started.running.sqlite
          .prepare(
            "UPDATE resource_operations SET status = 'WRITING' WHERE kind = 'service.control' AND idempotency_key = ?",
          )
          .run("human-restart");
        await started.running.serviceOps.reconcile();
        expect((await control("restart", "human-restart")).statusCode).toBe(409);
        expect(started.running.serviceOps.getService(controlled.targetId).pid).toBe(
          restarted.json<{ pid: number }>().pid,
        );
        expect(await (await fetch(`http://127.0.0.1:${ports[1]}`)).text()).toBe(controlled.pm2Name);
        const first = sessions[0];
        if (!first) throw new Error("missing session");
        const stop = await started.running.app.inject({
          method: "POST",
          url: `/api/sessions/${first.id}/turns`,
          headers: auth,
          payload: { input: "stop" },
        });
        await waitTurn(stop.json<{ turnId: string }>().turnId);
        await started.running.serviceOps.reconcile();
        expect(
          started.running.serviceOps
            .listServices()
            .find(({ projectId }) => projectId === first.projectId)?.observedState,
        ).toBe("stopped");
        const firstService = services.find((item) => item.projectId === first.projectId);
        if (!firstService) throw new Error("missing first service");
        const deleted = await started.running.app.inject({
          method: "POST",
          url: `/api/sessions/${first.id}/turns`,
          headers: auth,
          payload: { input: "delete" },
        });
        await waitTurn(deleted.json<{ turnId: string }>().turnId);
        const afterDelete = await started.running.app.inject({
          url: "/api/service-ops/services",
          headers: auth,
        });
        expect(
          afterDelete.json<{ items: ServiceOpsServiceDto[] }>().items.map((item) => item.targetId),
        ).not.toContain(firstService.targetId);
        expect(started.running.serviceOps.getService(firstService.targetId).targetId).toBe(
          firstService.targetId,
        );
        const recreated = await started.running.app.inject({
          method: "POST",
          url: `/api/sessions/${first.id}/turns`,
          headers: auth,
          payload: { input: "deploy api again" },
        });
        await waitTurn(recreated.json<{ turnId: string }>().turnId);
        await started.running.serviceOps.reconcile();
        expect(
          started.running.serviceOps
            .listServices()
            .find((item) => item.projectId === first.projectId),
        ).toMatchObject({ targetId: firstService.targetId, observedState: "running" });
        const secondName = usedNames[1];
        await stopAuthorizedServer(started);
        stopped = true;
        expect(await (await fetch(`http://127.0.0.1:${ports[1]}`)).text()).toBe(secondName);
      } finally {
        if (!stopped) await stopAuthorizedServer(started);
        if (started.running.pm2Global.status === "ready") {
          await new Pm2Adapter(started.running.pm2Global, started.running.dataDir).close();
        }
      }
    });
  }, 240_000);
});
