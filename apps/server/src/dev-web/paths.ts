import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const Manifest = z.object({
  dependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});
const contains = (root: string, file: string) => file === root || file.startsWith(root + path.sep);
export function webRoots(webRoot: string): string[] {
  const roots = new Set<string>();
  const visit = (directory: string) => {
    if (!existsSync(directory)) return;
    const root = realpathSync(directory);
    if (roots.has(root)) return;
    roots.add(root);
    const manifestPath = path.join(root, "package.json");
    if (!existsSync(manifestPath)) return;
    const pkg = Manifest.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
    for (const name of Object.keys({
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...pkg.peerDependencies,
    })) {
      let base = root;
      for (;;) {
        const candidate = path.join(base, "node_modules", name);
        if (existsSync(candidate)) {
          visit(candidate);
          break;
        }
        const parent = path.dirname(base);
        if (parent === base) break;
        base = parent;
      }
    }
  };
  visit(webRoot);
  visit(path.resolve(webRoot, "../../packages/ui"));
  visit(path.resolve(webRoot, "../../packages/shared"));
  visit(path.join(webRoot, "node_modules/vite"));
  return [...roots];
}
export function isDevPath(pathname: string): boolean {
  return /^\/(?:@vite(?:\/|$)|@react-refresh(?:\/|$)|@fs(?:\/|$)|@id(?:\/|$)|src(?:\/|$)|node_modules(?:\/|$)|__vite|__open-in-editor|_larness(?:\/|$))/.test(
    pathname,
  );
}
export function permittedPath(rawUrl: string, webRoot: string, roots: string[]): boolean {
  try {
    const rawPath = rawUrl.split("?")[0] ?? "";
    const decoded = decodeURIComponent(rawPath);
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      decoded.includes("%") ||
      decoded.includes("\\") ||
      decoded.includes("\0")
    )
      return false;
    const segments = decoded.split("/");
    if (
      segments.some(
        (s) =>
          s === ".." ||
          s === "." ||
          s.startsWith(".env") ||
          s === ".git" ||
          /^(?:config\.json|master\.key|larness\.(?:db|lock)|vite\.config\..*|.*\.log)$/.test(s),
      )
    )
      return false;
    if (
      /^\/(?:api|ws|_larness)(?:\/|$)/.test(decoded) ||
      decoded.startsWith("/__open-in-editor") ||
      decoded.startsWith("/__vite")
    )
      return false;
    const file = decoded.startsWith("/@fs/") ? decoded.slice(4) : path.join(webRoot, decoded);
    if (existsSync(file))
      return roots.some((root) => contains(realpathSync(root), realpathSync(file)));
    // A missing path below a symlink must still be checked through its nearest ancestor.
    let ancestor = file;
    while (!existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) return false;
      ancestor = parent;
    }
    return roots.some((root) => contains(realpathSync(root), realpathSync(ancestor)));
  } catch {
    return false;
  }
}
