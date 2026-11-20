import { describe, expect, it } from "vitest";
import { REDACTED_TOOL_SUMMARY, safeToolSummary } from "../../src/modules/agent/toolSummary.js";
import { SecretStore } from "../../src/security/secretStore.js";
import { withTempDir } from "../helpers.js";

describe("safe tool summary", () => {
  it("keeps a normal summary", () => {
    expect(safeToolSummary("web search: release notes", [], undefined)).toBe(
      "web search: release notes",
    );
  });

  it("redacts a summary containing a configured secret", async () => {
    await withTempDir(async (dir) => {
      const store = await SecretStore.open(dir);
      const encrypted = store.encrypt("sk-live-secret");

      expect(safeToolSummary("web search: sk-live-secret", [encrypted], store)).toBe(
        REDACTED_TOOL_SUMMARY,
      );
    });
  });

  it("fails closed when the secret store is unavailable", async () => {
    await withTempDir(async (dir) => {
      const store = await SecretStore.open(dir);
      const encrypted = store.encrypt("sk-live-secret");

      expect(safeToolSummary("web search: harmless", [encrypted], undefined)).toBe(
        REDACTED_TOOL_SUMMARY,
      );
    });
  });
});
