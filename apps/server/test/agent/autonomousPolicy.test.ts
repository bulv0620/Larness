import { createFakeProvider, createFileToolRegistry, defineTool } from "@larness/agent";
import { expect, it } from "vitest";
import { z } from "zod";
import { TurnRunner } from "../../src/modules/agent/turnRunner.js";
import { createSession } from "../../src/modules/sessions/service.js";
import { createTurn } from "../../src/modules/sessions/turns.js";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

it("uses the authenticated autonomous Turn snapshot without approval, still validating tool input", async () => {
  await withTempDir(async (dir) => {
    const f = await startAuthorizedServer(dir);
    try {
      const headers = { cookie: f.cookie, origin: f.origin, "x-csrf-token": f.csrf };
      const session = await createSession({ db: f.running.db, dataDir: f.running.dataDir }, {});
      const change = (policy: string, auth = headers) =>
        f.running.app.inject({
          method: "PATCH",
          url: `/api/sessions/${session.id}`,
          headers: auth,
          payload: { approvalPolicyId: policy },
        });
      expect((await change("autonomous", { origin: f.origin } as typeof headers)).statusCode).toBe(
        401,
      );
      expect((await change("unknown")).statusCode).toBe(400);
      expect((await change("autonomous")).json().approvalPolicyId).toBe("autonomous");
      const client = (await f.running.app.inject({ url: "/api/auth/session", headers })).json()
        .clientSessionId as string;
      const turn = createTurn(
        { db: f.running.db },
        { sessionId: session.id, text: "autonomous test", clientSessionId: client },
      );
      await change("standard"); // Existing Turn remains bound to autonomous.
      const registry = createFileToolRegistry();
      let calls = 0;
      for (const risk of ["L2", "L3"] as const)
        registry.register(
          defineTool({
            name: `probe_${risk}`,
            description: "Safe test probe",
            riskLevel: risk,
            requiresProjectLock: false,
            schema: z.object({ value: z.literal("ok") }).strict(),
            handler: async () => {
              calls++;
              return { ok: true, summary: "checked" };
            },
          }),
        );
      const provider = createFakeProvider([
        {
          chunks: [
            { type: "tool-call", toolCall: { id: "l2", name: "probe_L2", args: { value: "ok" } } },
            { type: "tool-call", toolCall: { id: "l3", name: "probe_L3", args: { value: "ok" } } },
            {
              type: "tool-call",
              toolCall: { id: "invalid", name: "probe_L3", args: { value: "invalid" } },
            },
            { type: "finish", finishReason: "tool-calls" },
          ],
        },
        {
          chunks: [
            { type: "text-delta", text: "done" },
            { type: "finish", finishReason: "stop" },
          ],
        },
      ]);
      const runner = new TurnRunner({
        db: f.running.db,
        registry,
        resolveProvider: () => ({ adapter: provider, model: "fake" }),
      });
      expect((await runner.run(turn.turnId)).status).toBe("COMPLETED");
      expect(calls).toBe(2);
      expect(
        f.running.sqlite
          .prepare("SELECT count(*) AS n FROM approvals WHERE turn_id=?")
          .get(turn.turnId),
      ).toEqual({ n: 0 });
      expect(
        f.running.sqlite
          .prepare("SELECT count(*) AS n FROM audit_logs WHERE action='tool.completed'")
          .get(),
      ).toEqual({ n: 2 });
    } finally {
      await stopAuthorizedServer(f);
    }
  });
});
