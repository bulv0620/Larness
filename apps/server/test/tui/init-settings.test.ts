import { describe, expect, it, vi } from "vitest";
import { runInitWizard } from "../../src/tui/init-flow.js";
import { testConfig } from "../helpers.js";

const result = { origin: "https://custom.example", rpId: "custom.example", restartRequired: false };
function prompts(advanced = false) {
  return {
    advanced: vi.fn(async () => advanced),
    host: vi.fn(async () => "127.0.0.1"),
    port: vi.fn(async () => "3210"),
    publicUrl: vi.fn(async () => "https://custom.example"),
    confirm: vi.fn(async () => true),
    notify: vi.fn(),
  };
}

describe("initialization settings", () => {
  it("uses effective defaults without password, network or update-channel questions", async () => {
    const ask = prompts();
    const apply = vi.fn(async () => result);
    await runInitWizard(ask, apply, {
      config: testConfig({ server: { publicUrl: result.origin } }),
    });
    expect(apply).toHaveBeenCalledWith({});
    expect(ask.host).not.toHaveBeenCalled();
    expect(ask.port).not.toHaveBeenCalled();
    expect(ask.publicUrl).not.toHaveBeenCalled();
    expect(ask.confirm).toHaveBeenCalledWith(expect.stringContaining(result.origin));
  });

  it("only persists explicit advanced changes and retains first-dev origin defaults", async () => {
    const ask = prompts(true);
    ask.port.mockResolvedValue("4000");
    const apply = vi.fn(async () => result);
    await runInitWizard(ask, apply, {
      config: testConfig({ server: { publicUrl: result.origin } }),
    });
    expect(apply).toHaveBeenCalledWith({ port: 4000 });
    const devApply = vi.fn(async () => result);
    await runInitWizard(prompts(), devApply, {
      config: testConfig({ server: { publicUrl: "http://localhost:5173" } }),
      initialParams: { publicUrl: "http://localhost:5173" },
    });
    expect(devApply).toHaveBeenCalledWith({ publicUrl: "http://localhost:5173" });
  });

  it("rejects changing a field controlled by environment without applying", async () => {
    const ask = prompts(true);
    ask.port.mockResolvedValue("4000");
    const apply = vi.fn(async () => result);
    await expect(
      runInitWizard(ask, apply, {
        config: testConfig({ server: { publicUrl: result.origin } }),
        env: { LARNESS_PORT: "3210" },
        maxAttempts: 1,
      }),
    ).rejects.toThrow(/LARNESS_PORT/);
    expect(apply).not.toHaveBeenCalled();
  });
});
