import { describe, expect, it, vi } from "vitest";
import { commandSecretVerdict, createCommandTool } from "../../src/modules/agent/commandTool.js";
import { createSecretLoader } from "../../src/modules/agent/turn/secrets.js";
import type { SecretStore } from "../../src/security/secretStore.js";

function secretRow(ciphertext: string): { ciphertext: string; nonce: string; tag: string } {
  return { ciphertext, nonce: "nonce", tag: "tag" };
}

function stubStore(
  plaintextByCiphertext: Record<string, string>,
  counter: { decrypts: number },
): SecretStore {
  return {
    decrypt: (secret: { ciphertext: string }) => {
      counter.decrypts += 1;
      return plaintextByCiphertext[secret.ciphertext] ?? "";
    },
  } as unknown as SecretStore;
}

describe("command secret verdict", () => {
  it("blocks a command whose arguments contain a stored credential", () => {
    const counter = { decrypts: 0 };
    const store = stubStore({ c1: "sk-live-123" }, counter);

    expect(commandSecretVerdict(["node", "sk-live-123"], [secretRow("c1")], store)).toBe("blocked");
    expect(counter.decrypts).toBe(1);
  });

  it("allows unrelated commands and fails closed without a store", () => {
    const counter = { decrypts: 0 };
    const store = stubStore({ c1: "sk-live-123" }, counter);

    expect(commandSecretVerdict(["node", "test"], [secretRow("c1")], store)).toBe("ok");
    expect(commandSecretVerdict(["node", "test"], [], undefined)).toBe("ok");
    expect(commandSecretVerdict(["node", "test"], [secretRow("c1")], undefined)).toBe(
      "unavailable",
    );
  });
});

describe("plan secret guard", () => {
  it("blocks a plan that contains a credential and fails closed without a store", async () => {
    const { createPlanTool } = await import("../../src/modules/agent/planTool.js");
    const counter = { decrypts: 0 };
    const store = stubStore({ c1: "sk-live-123" }, counter);
    const plan = {
      title: "任务",
      steps: [{ id: "s1", title: "复制 sk-live-123 到配置", status: "pending" }],
    };
    const context = {
      projectRoot: "/tmp",
      loadSecrets: () => [secretRow("c1")],
      updatePlan: vi.fn(async () => ({ ok: true as const, summary: "plan" })),
    };

    const blocked = await createPlanTool({ db: {} as never, secretStore: store }).execute(
      plan,
      context,
    );
    expect(blocked).toMatchObject({ ok: false, errorCode: "FORBIDDEN" });
    expect(context.updatePlan).not.toHaveBeenCalled();

    const withoutStore = await createPlanTool({ db: {} as never }).execute(plan, context);
    expect(withoutStore).toMatchObject({
      ok: false,
      summary: "Plan protection unavailable",
    });

    const clean = await createPlanTool({ db: {} as never, secretStore: store }).execute(
      { title: "任务", steps: [{ id: "s1", title: "正常步骤", status: "pending" }] },
      context,
    );
    expect(clean).toMatchObject({ ok: true });
  });
});

describe("per-turn secret loading", () => {
  it("reads the secret rows once per Turn", () => {
    const load = vi.fn(() => [secretRow("c1")]);
    const loadSecrets = createSecretLoader(load);

    loadSecrets();
    loadSecrets();
    loadSecrets();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("decrypts per call and never runs a blocked command", async () => {
    const counter = { decrypts: 0 };
    const tool = createCommandTool({ secretStore: stubStore({ c1: "sk-live-123" }, counter) });
    const loadSecrets = vi.fn(() => [secretRow("c1")]);
    const runCommand = vi.fn(async () => ({ ok: true as const, summary: "ran" }));
    const context = { projectRoot: "/tmp", loadSecrets, runCommand };

    const blocked = await tool.execute(
      { executable: "node", cwd: ".", args: ["sk-live-123"] },
      context,
    );
    const allowed = await tool.execute({ executable: "node", cwd: ".", args: ["test"] }, context);

    expect(blocked).toMatchObject({
      ok: false,
      errorCode: "FORBIDDEN",
      summary: "Protected credentials cannot be command arguments",
    });
    expect(runCommand).toHaveBeenCalledTimes(1);
    expect(allowed).toMatchObject({ ok: true });
    // Two calls, two decryptions: plaintext is never cached across calls.
    expect(counter.decrypts).toBe(2);
  });

  it("fails closed when secrets exist but no store is configured", async () => {
    const tool = createCommandTool({});
    const runCommand = vi.fn(async () => ({ ok: true as const, summary: "ran" }));

    const result = await tool.execute(
      { executable: "node", cwd: ".", args: ["test"] },
      { projectRoot: "/tmp", loadSecrets: () => [secretRow("c1")], runCommand },
    );

    expect(result).toMatchObject({ ok: false, errorCode: "FORBIDDEN" });
    expect(runCommand).not.toHaveBeenCalled();
  });
});
