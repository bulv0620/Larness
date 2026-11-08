import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { checkForUpdate, updateChannel, updateNoticeText } from "../../src/modules/updates/npm.js";
import { withTempDir } from "../helpers.js";

beforeEach(() => {
  delete process.env.LARNESS_DEV;
});

function fetchTags(tags: Record<string, string>, counter?: { calls: number }): typeof fetch {
  return (async () => {
    if (counter) counter.calls += 1;
    return new Response(JSON.stringify(tags), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("npm update check", () => {
  it("reports a newer stable version once and persists state with 0600", async () => {
    await withTempDir(async (dir) => {
      let now = 1_000_000;
      const counter = { calls: 0 };
      const first = await checkForUpdate({
        version: "0.1.0",
        dataDir: dir,
        now: () => now,
        fetchImpl: fetchTags({ latest: "0.2.0", beta: "0.3.0" }, counter),
      });

      expect(first).toMatchObject({
        currentVersion: "0.1.0",
        latestVersion: "0.2.0",
        channel: "stable",
        command: "npm install -g larness@latest",
      });
      expect(first && updateNoticeText(first)).toContain("有新版本 0.2.0");
      const stateFile = path.join(dir, "updates", "state.json");
      expect(statSync(stateFile).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(stateFile, "utf8"))).toMatchObject({
        lastNotifiedVersion: "0.2.0",
      });

      now += 60 * 60 * 1000;
      const second = await checkForUpdate({
        version: "0.1.0",
        dataDir: dir,
        now: () => now,
        fetchImpl: fetchTags({ latest: "0.2.0" }, counter),
      });
      expect(second).toBeNull();
      expect(counter.calls).toBe(1);
    });
  });

  it("returns no notice when current is latest or beta channel is selected", async () => {
    await withTempDir(async (dir) => {
      const same = await checkForUpdate({
        version: "0.2.0",
        dataDir: dir,
        fetchImpl: fetchTags({ latest: "0.2.0" }),
      });
      expect(same).toBeNull();

      const beta = await checkForUpdate({
        version: "0.2.0",
        dataDir: dir,
        channel: "beta",
        now: () => Date.now() + 25 * 60 * 60 * 1000,
        fetchImpl: fetchTags({ latest: "0.2.0", beta: "0.3.0" }),
      });
      expect(beta).toMatchObject({
        latestVersion: "0.3.0",
        channel: "beta",
        command: "npm install -g larness@beta",
      });
    });
  });

  it("silently throttles network failures and skips development versions", async () => {
    await withTempDir(async (dir) => {
      let now = 1_000_000;
      const failed = await checkForUpdate({
        version: "0.1.0",
        dataDir: dir,
        now: () => now,
        fetchImpl: (async () => {
          throw new Error("offline");
        }) as typeof fetch,
      });
      expect(failed).toBeNull();

      now += 60 * 60 * 1000;
      const skipped = await checkForUpdate({
        version: "0.1.0",
        dataDir: dir,
        now: () => now,
        fetchImpl: (async () => {
          throw new Error("must not be called");
        }) as typeof fetch,
      });
      expect(skipped).toBeNull();

      {
        process.env.LARNESS_DEV = "1";
        const dev = await checkForUpdate({
          version: "0.1.0",
          dataDir: dir,
          fetchImpl: fetchTags({ latest: "9.0.0" }),
        });
        expect(dev).toBeNull();
        delete process.env.LARNESS_DEV;
      }
    });
  });

  it("normalizes the channel", () => {
    expect(updateChannel("beta")).toBe("beta");
    expect(updateChannel("stable")).toBe("stable");
    expect(updateChannel("nightly")).toBe("stable");
  });
});
