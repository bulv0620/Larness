import { mkdir, realpath, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../helpers.js";
import { startAuthorizedServer, stopAuthorizedServer } from "../support/server.js";

describe("directory browsing API", () => {
  it("lists directories only for the local authenticated user", async () => {
    await withTempDir(async (dir) => {
      const root = path.join(dir, "project");
      await mkdir(path.join(root, "src"), { recursive: true });
      await mkdir(path.join(root, "docs"));
      await writeFile(path.join(root, "README.md"), "# hello\n");

      if (process.platform !== "win32") {
        await symlink(path.join(root, "src"), path.join(root, "linked"));
      }

      const started = await startAuthorizedServer(dir);

      try {
        const unauthenticated = await started.running.app.inject({
          method: "GET",
          url: `/api/fs/directories?path=${encodeURIComponent(root)}`,
        });
        expect(unauthenticated.statusCode).toBe(401);

        const listing = await started.running.app.inject({
          method: "GET",
          url: `/api/fs/directories?path=${encodeURIComponent(root)}`,
          headers: { cookie: started.cookie },
        });
        expect(listing.statusCode).toBe(200);
        const body = listing.json() as {
          path: string;
          parent: string | null;
          entries: { name: string }[];
          truncated: boolean;
        };
        expect(body.path).toBe(await realpath(root));
        expect(body.parent).toBe(await realpath(dir));
        expect(body.entries.map((entry) => entry.name)).toEqual(["docs", "src"]);
        expect(body.truncated).toBe(false);

        const relative = await started.running.app.inject({
          method: "GET",
          url: "/api/fs/directories?path=relative/path",
          headers: { cookie: started.cookie },
        });
        expect(relative.statusCode).toBe(400);

        const file = await started.running.app.inject({
          method: "GET",
          url: `/api/fs/directories?path=${encodeURIComponent(path.join(root, "README.md"))}`,
          headers: { cookie: started.cookie },
        });
        expect(file.statusCode).toBe(400);

        const missing = await started.running.app.inject({
          method: "GET",
          url: `/api/fs/directories?path=${encodeURIComponent(path.join(root, "missing"))}`,
          headers: { cookie: started.cookie },
        });
        expect(missing.statusCode).toBe(404);
      } finally {
        await stopAuthorizedServer(started);
      }
    });
  });
});
