import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
let prepared = false;

/**
 * npm 11 / global installs can leave node-pty's packaged spawn-helper without
 * its executable bit. Repair it before the first PTY is created; the helper is
 * already shipped in the package, so this does not download or build anything.
 */
export function ensurePtySpawnHelper(): void {
  if (prepared || process.platform !== "darwin") {
    return;
  }
  prepared = true;

  try {
    const packageFile = require.resolve("node-pty/package.json");
    const root = path.dirname(packageFile);
    for (const relative of [
      `prebuilds/darwin-${process.arch}/spawn-helper`,
      "build/Release/spawn-helper",
    ]) {
      const helper = path.join(root, relative);
      if (!existsSync(helper)) {
        continue;
      }
      try {
        chmodSync(helper, 0o755);
      } catch {
        // The PTY spawn will report the actionable failure if this remains denied.
      }
    }
  } catch {
    // node-pty is optional for non-terminal commands; keep startup non-fatal.
  }
}
