import { describe, expect, it } from "vitest";
import { profileToolNames, type ToolPackCatalog, toolAvailability } from "../../src/index.js";

const catalog: ToolPackCatalog = {
  packs: {
    "core.read": { id: "core.read", label: "read", tools: ["read_file"] },
    "core.write": { id: "core.write", label: "write", tools: ["write_file"] },
    "core.command": { id: "core.command", label: "command", tools: ["run_command"] },
    plan: { id: "plan", label: "plan", tools: ["update_plan"] },
    process: { id: "process", label: "process", tools: ["start_process"] },
    observation: { id: "observation", label: "observation", tools: ["refresh_observations"] },
    serviceOps: { id: "serviceOps", label: "serviceOps", tools: ["list_service_ops"] },
  },
  profiles: {
    coding: {
      id: "coding",
      label: "Coding",
      packs: ["core.read", "core.write", "core.command", "process"],
    },
    plan: { id: "plan", label: "Plan", packs: ["core.read", "plan"] },
    "service-ops": {
      id: "service-ops",
      label: "服务运维",
      packs: ["core.read", "observation", "serviceOps"],
    },
  },
};

describe("agent profiles", () => {
  it("resolves coding to core tools only", () => {
    expect([...profileToolNames(catalog, "coding")]).toEqual([
      "read_file",
      "write_file",
      "run_command",
      "start_process",
    ]);
  });

  it("resolves service-ops to the read-only observation surface", () => {
    expect([...profileToolNames(catalog, "service-ops")]).toEqual([
      "read_file",
      "refresh_observations",
      "list_service_ops",
    ]);
  });

  it("rejects unknown profiles and packs instead of silently exposing tools", () => {
    expect(() => profileToolNames(catalog, "invented" as "coding")).toThrow(
      /unknown agent profile/,
    );
    expect(() =>
      profileToolNames(
        {
          packs: catalog.packs,
          profiles: {
            ...catalog.profiles,
            coding: { id: "coding", label: "Coding", packs: ["missing" as "core.read"] },
          },
        },
        "coding",
      ),
    ).toThrow(/unknown tool pack/);
  });

  it("reports project-required and disabled availability", () => {
    expect(toolAvailability(catalog, "coding", "read_file", false)).toBe("enabled");
    expect(toolAvailability(catalog, "coding", "start_process", true)).toBe("project-required");
    expect(toolAvailability(catalog, "service-ops", "start_process", true)).toBe("disabled");
  });
});
