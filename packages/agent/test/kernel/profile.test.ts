import { describe, expect, it } from "vitest";
import { profileToolNames, type ToolPackCatalog, toolAvailability } from "../../src/index.js";

const catalog: ToolPackCatalog = {
  packs: {
    "core.read": { id: "core.read", label: "read", tools: ["read_file"] },
    "core.write": { id: "core.write", label: "write", tools: ["write_file"] },
    "core.command": { id: "core.command", label: "command", tools: ["run_command"] },
    plan: { id: "plan", label: "plan", tools: ["update_plan"] },
    service: { id: "service", label: "service", tools: ["list_services"] },
    observation: { id: "observation", label: "observation", tools: ["refresh_observations"] },
  },
  profiles: {
    coding: {
      id: "coding",
      label: "Coding",
      packs: ["core.read", "core.write", "core.command"],
    },
    plan: { id: "plan", label: "Plan", packs: ["core.read", "plan"] },
    workspace: {
      id: "workspace",
      label: "Workspace",
      packs: ["core.read", "core.write", "core.command", "plan", "service", "observation"],
    },
  },
};

describe("agent profiles", () => {
  it("resolves coding to core tools only", () => {
    expect([...profileToolNames(catalog, "coding")]).toEqual([
      "read_file",
      "write_file",
      "run_command",
    ]);
  });

  it("resolves workspace to the full pack surface", () => {
    expect([...profileToolNames(catalog, "workspace")]).toHaveLength(6);
    expect(profileToolNames(catalog, "workspace").has("list_services")).toBe(true);
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
    expect(toolAvailability(catalog, "coding", "list_services", true)).toBe("disabled");
    expect(toolAvailability(catalog, "workspace", "list_services", true)).toBe("project-required");
  });
});
