import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { resolveManualShell } from "../../src/modules/terminals/shell.js";
import { withTempDir } from "../helpers.js";

it("uses an executable absolute account shell without interpreting command text", async () => {
  await withTempDir(async (dir) => {
    const executable = path.join(dir, "my shell");
    await writeFile(executable, '#!/bin/sh\nexec /bin/sh "$@"\n', { mode: 0o700 });
    expect(await resolveManualShell(executable)).toBe(executable);
    for (const invalid of ["sh", "", `${executable} -i`, path.join(dir, "missing"), dir])
      expect(await resolveManualShell(invalid)).toBe("/bin/sh");
    await chmod(executable, 0o600);
    expect(await resolveManualShell(executable)).toBe("/bin/sh");
    const folder = path.join(dir, "folder");
    await mkdir(folder);
    expect(await resolveManualShell(folder)).toBe("/bin/sh");
  });
});
