import { afterEach, expect, it, vi } from "vitest";
import { setCsrfToken } from "@/lib/api";
import { controlFormalService } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});
it("sends an object JSON body and CSRF through the actual fetch boundary", async () => {
  const input = {
    action: "stop",
    expectedPm2Name: "larness:prj_one:api",
    requestKey: "control-one",
    confirmed: true,
  } as const;
  const service = {
    targetId: "tgt_00000000-0000-4000-8000-000000000001",
    projectId: "prj_one",
    projectName: "demo",
    name: "api",
    pm2Name: input.expectedPm2Name,
    source: "pm2-cli",
    version: null,
    artifactHash: null,
    desiredState: "stopped",
    observedState: "stopped",
    pid: null,
    lastHealthAt: null,
    reasonCode: null,
    updatedAt: 1,
  };
  const fetch = vi.fn(async () => new Response(JSON.stringify(service), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  setCsrfToken("csrf-test-value");
  await controlFormalService(service.targetId, input);
  const request = vi.mocked(globalThis.fetch).mock.calls[0]?.[1];
  expect(request?.headers).toMatchObject({
    "x-csrf-token": "csrf-test-value",
    "content-type": "application/json",
  });
  expect(JSON.parse(String(request?.body))).toEqual(input);
});
