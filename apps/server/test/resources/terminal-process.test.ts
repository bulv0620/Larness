import { expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ reads: 0, alive: true }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  const { promisify } = await import("node:util");
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: async () => {
      fixture.reads++;
      // The shell forks a child after discovery, just before group termination.
      const leader = "40000 1 40000 40000 S Wed Nov 4 00:00:00 2026\n";
      const child = "40001 40000 40000 40000 S Wed Nov 4 00:00:01 2026\n";
      return {
        stdout: fixture.alive ? leader + (fixture.reads >= 5 ? child : "") : "",
        stderr: "",
      };
    },
  });
  return { ...actual, execFile };
});

it("confirms a stop when a shell forks into its own group between process snapshots", async () => {
  const { ManagedPty } = await import("@larness/resources");
  let onExit: (event: { exitCode: number }) => void = () => undefined;
  const kill = vi.spyOn(process, "kill").mockImplementation(() => {
    fixture.alive = false;
    onExit({ exitCode: 0 });
    return true;
  });
  try {
    const pty = new ManagedPty(
      {
        pid: 40000,
        write: () => undefined,
        resize: () => undefined,
        onData: () => ({ dispose: () => undefined }),
        onExit: (callback) => {
          onExit = callback;
          return { dispose: () => undefined };
        },
      },
      [],
      () => undefined,
    );
    await pty.ready;
    expect(await pty.stop()).toBe(true);
    expect(kill).toHaveBeenCalledWith(-40000, "SIGTERM");
    expect(await pty.done).toEqual({ exitCode: 0, stopped: true });
  } finally {
    kill.mockRestore();
  }
});
