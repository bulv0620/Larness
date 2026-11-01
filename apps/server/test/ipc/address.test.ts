import path from "node:path";
import { describe, expect, it } from "vitest";
import { ipcTokenPath, resolveIpcAddress } from "../../src/ipc/address.js";

describe("resolveIpcAddress", () => {
  it("uses a 0600 unix socket inside the data directory when short enough", () => {
    const address = resolveIpcAddress("/tmp/larness-data", "linux", "/tmp");

    expect(address.kind).toBe("unix");
    expect(address.path).toBe(path.join("/tmp/larness-data", "ipc", "larness.sock"));
    expect(address.tempDirectory).toBeNull();
  });

  it("falls back to a hashed tmp directory when the path is too long", () => {
    const dataDir = path.join("/tmp", "x".repeat(120));
    const address = resolveIpcAddress(dataDir, "darwin", "/var/folders/tmp");

    expect(address.kind).toBe("unix");
    expect(address.tempDirectory).toMatch(/larness-[0-9a-f]{16}$/);
    expect(address.path).toBe(path.join(address.tempDirectory ?? "", "larness.sock"));
    expect(Buffer.byteLength(address.path, "utf8")).toBeLessThanOrEqual(100);
  });

  it("uses a named pipe on Windows", () => {
    const address = resolveIpcAddress("C:\\Larness", "win32");

    expect(address.kind).toBe("pipe");
    expect(address.path).toMatch(/^\\\\\.\\pipe\\larness-[0-9a-f]{16}$/);
    expect(address.tempDirectory).toBeNull();
  });

  it("keeps the token next to the socket metadata directory", () => {
    expect(ipcTokenPath("/tmp/larness-data")).toBe(path.join("/tmp/larness-data", "ipc", "token"));
  });
});
