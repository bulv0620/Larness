import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tsdownConfig from "../../tsdown.config.js";

const serverRoot = fileURLToPath(new URL("../../", import.meta.url));

interface ServerManifest {
  dependencies?: Record<string, string>;
}

function isBundled(dependency: string): boolean {
  const config = Array.isArray(tsdownConfig) ? tsdownConfig[0] : tsdownConfig;
  const alwaysBundle = config?.deps?.alwaysBundle;

  if (alwaysBundle === undefined) {
    return false;
  }

  if (typeof alwaysBundle === "function") {
    return alwaysBundle(dependency, undefined) === true;
  }

  const patterns = Array.isArray(alwaysBundle) ? alwaysBundle : [alwaysBundle];

  return patterns.some((pattern) =>
    typeof pattern === "string" ? pattern === dependency : pattern.test(dependency),
  );
}

describe("server build", () => {
  it("bundles every workspace dependency", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(serverRoot, "package.json"), "utf8"),
    ) as ServerManifest;
    const workspaceDependencies = Object.keys(manifest.dependencies ?? {}).filter((name) =>
      name.startsWith("@larness/"),
    );

    expect(workspaceDependencies.length).toBeGreaterThan(0);

    for (const dependency of workspaceDependencies) {
      expect(isBundled(dependency), `${dependency} must be bundled`).toBe(true);
    }
  });
});
