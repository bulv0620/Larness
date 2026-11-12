import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decideToolAccess, defineTool, ToolRegistry, truncateToolText } from "../../src/index.js";

const echoTool = defineTool({
  name: "echo",
  description: "Echo input",
  riskLevel: "L1",
  schema: z.object({ text: z.string().min(1) }).strict(),
  summarize: (args) => `echo ${args.text}`,
  async handler(args) {
    return { ok: true, summary: args.text, data: { text: args.text } };
  },
});

describe("ToolRegistry", () => {
  it("registers tools, validates arguments and normalizes results", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);

    expect(registry.list()).toEqual([{ name: "echo", description: "Echo input", riskLevel: "L1" }]);
    expect(echoTool.summarize?.({ text: "hi" })).toBe("echo hi");

    await expect(
      registry.execute("echo", { text: "hi" }, { projectRoot: "/tmp" }),
    ).resolves.toEqual({ ok: true, summary: "hi", data: { text: "hi" } });

    const invalid = await registry.execute("echo", { text: "" }, { projectRoot: "/tmp" });
    expect(invalid).toMatchObject({ ok: false, errorCode: "VALIDATION_ERROR" });
    expect(invalid.summary).toBe("invalid tool arguments");
  });

  it("repairs known argument aliases before schema validation", async () => {
    const statusTool = defineTool({
      name: "status_like",
      description: "Status",
      riskLevel: "L0",
      schema: z.object({ status: z.enum(["running", "done"]) }).strict(),
      repairArgs: (raw) => {
        const args = raw as { status?: unknown };
        const aliases: Record<string, string> = { in_progress: "running", completed: "done" };
        const mapped = typeof args.status === "string" ? aliases[args.status] : undefined;
        return mapped === undefined ? raw : { status: mapped };
      },
      summarize: (args) => `status ${args.status}`,
      async handler(args) {
        return { ok: true, summary: args.status };
      },
    });

    await expect(
      statusTool.execute({ status: "in_progress" }, { projectRoot: "/tmp" }),
    ).resolves.toMatchObject({ ok: true, summary: "running" });
    await expect(
      statusTool.execute({ status: "invented" }, { projectRoot: "/tmp" }),
    ).resolves.toMatchObject({ ok: false, errorCode: "VALIDATION_ERROR" });
    // The runner summarizes the raw call; it must see the same repaired args.
    expect(statusTool.summarize?.({ status: "in_progress" })).toBe("status running");
  });

  it("rejects duplicate registrations and unknown tools", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);

    expect(() => registry.register(echoTool)).toThrow(/already registered/);
    await expect(registry.execute("missing", {}, { projectRoot: "/tmp" })).resolves.toMatchObject({
      ok: false,
      errorCode: "TOOL_NOT_FOUND",
    });
  });

  it("converts thrown handler errors into a safe tool error", async () => {
    const registry = new ToolRegistry();
    registry.register(
      defineTool({
        name: "boom",
        description: "Boom",
        riskLevel: "L0",
        schema: z.object({}),
        async handler() {
          throw new Error("secret detail");
        },
      }),
    );

    const result = await registry.execute("boom", {}, { projectRoot: "/tmp" });
    expect(result).toEqual({
      ok: false,
      errorCode: "TOOL_ERROR",
      summary: "tool failed: boom",
    });
    expect(result.summary).not.toContain("secret detail");
  });
});

describe("tool access policy", () => {
  it("maps standard, strict and readonly policies to tool risk levels", () => {
    expect(decideToolAccess("standard", "L0")).toBe("allow");
    expect(decideToolAccess("standard", "L1")).toBe("allow");
    expect(decideToolAccess("standard", "L2")).toBe("require_approval");
    expect(decideToolAccess("strict", "L0")).toBe("allow");
    expect(decideToolAccess("strict", "L1")).toBe("require_approval");
    expect(decideToolAccess("strict", "L2")).toBe("require_approval");
    expect(decideToolAccess("readonly", "L0")).toBe("allow");
    expect(decideToolAccess("readonly", "L1")).toBe("deny");
    expect(decideToolAccess("readonly", "L2")).toBe("deny");
  });
});

describe("truncateToolText", () => {
  it("caps lines and marks truncation", () => {
    const text = Array.from({ length: 2_001 }, (_, index) => `line ${index}`).join("\n");
    const result = truncateToolText(text);

    expect(result.truncated).toBe(true);
    expect(result.text.split("\n")).toHaveLength(2_000);
  });

  it("caps bytes and marks truncation", () => {
    const result = truncateToolText("a".repeat(1_048_577));
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, "utf8")).toBe(1_048_576);
  });
});

it("allows all registered risk levels only under the explicitly selected autonomous policy", () => {
  for (const risk of ["L0", "L1", "L2", "L3"] as const)
    expect(decideToolAccess("autonomous", risk)).toBe("allow");
  for (const policy of ["standard", "strict", "readonly"] as const)
    expect(decideToolAccess(policy, "L3")).toBe("deny");
});
