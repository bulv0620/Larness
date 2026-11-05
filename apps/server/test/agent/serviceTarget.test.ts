import { expect, it } from "vitest";
import { registeredServiceTarget } from "../../src/modules/agent/turnRunner.js";

const serviceId = "svc_00000000-0000-0000-0000-000000000001";

it("returns a preview target for a running service registration", () => {
  expect(
    registeredServiceTarget(
      "register_temporary_service",
      { serviceId, status: "RUNNING", name: "web" },
      "prj_1",
    ),
  ).toEqual({ kind: "preview", projectId: "prj_1", serviceId, path: "/", name: "web" });
});

it("does not offer preview for failed registrations or other tools", () => {
  expect(
    registeredServiceTarget(
      "register_temporary_service",
      { serviceId, status: "UNREGISTERED" },
      "prj_1",
    ),
  ).toBeUndefined();
  expect(
    registeredServiceTarget("list_services", { serviceId, status: "RUNNING" }, "prj_1"),
  ).toBeUndefined();
  expect(
    registeredServiceTarget("register_temporary_service", { serviceId, status: "RUNNING" }, null),
  ).toBeUndefined();
});
