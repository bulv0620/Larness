import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { managedCommands, resolveWebUrl } from "../../src/tui/supervisor.js";

const serverRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoRoot = path.resolve(serverRoot, "../..");

describe("managed TUI commands", () => {
  it("uses direct tsx and Vite entries in development", () => {
    const commands = managedCommands({ dev: true, serverRoot, repoRoot, nodePath: "/node" });

    expect(commands.serverCommand).toBe("/node");
    expect(commands.serverArgs[0]).toBe("--import");
    expect(commands.serverArgs[1]).toContain("tsx");
    expect(commands.serverArgs[2]).toBe(path.join(serverRoot, "src", "index.ts"));
    expect(commands.webCommand).toBe("/node");
    expect(commands.webArgs[0]).toContain(path.join("vite", "bin", "vite.js"));
    expect(commands.webCwd).toBe(path.join(repoRoot, "apps", "web"));
  });

  it("uses the built server and no Vite in production", () => {
    const commands = managedCommands({ dev: false, serverRoot, repoRoot, nodePath: "/node" });

    expect(commands.serverArgs).toEqual([path.join(serverRoot, "dist", "index.js")]);
    expect(commands.webCommand).toBeNull();
    expect(commands.webArgs).toEqual([]);
  });
});

describe("web origin resolution", () => {
  it("accepts dev at 5173 and rejects a stale production origin", () => {
    expect(
      resolveWebUrl({
        dev: true,
        serverPort: 3210,
        publicUrl: "http://localhost:5173",
        canonicalOrigin: "http://localhost:5173",
      }),
    ).toBe("http://localhost:5173");

    expect(() =>
      resolveWebUrl({
        dev: true,
        serverPort: 3210,
        publicUrl: "http://localhost:3210",
        canonicalOrigin: "http://localhost:3210",
      }),
    ).toThrow(/开发 Web 固定/);
  });

  it("accepts production at the server port but rejects the dev origin", () => {
    expect(
      resolveWebUrl({
        dev: false,
        serverPort: 3210,
        publicUrl: null,
        canonicalOrigin: "http://localhost:3210",
      }),
    ).toBe("http://localhost:3210");

    expect(() =>
      resolveWebUrl({
        dev: false,
        serverPort: 3210,
        publicUrl: "http://localhost:5173",
        canonicalOrigin: "http://localhost:5173",
      }),
    ).toThrow(/生产静态 Web/);
  });

  it("keeps a public HTTPS origin for reverse-proxied deployments", () => {
    expect(
      resolveWebUrl({
        dev: false,
        serverPort: 3210,
        publicUrl: "https://larness.example.com",
        canonicalOrigin: "https://larness.example.com",
      }),
    ).toBe("https://larness.example.com");
  });
});
