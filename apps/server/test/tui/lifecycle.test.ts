import { describe, expect, it } from "vitest";
import { runManagedSessions } from "../../src/tui/lifecycle.js";

function fixture(actions: ("done" | "restart")[], failRestart = false) {
  const events: string[] = [];
  let starts = 0;
  return {
    events,
    options: {
      start: async () => {
        const id = ++starts;
        events.push(`start:${id}`);
        if (failRestart && id === 2) throw new Error("port unavailable");
        return {
          id,
          stop: async () => {
            events.push(`stop:${id}`);
          },
        };
      },
      attach: async (runtime: { id: number }) => {
        events.push(`attach:${runtime.id}`);
        return actions.shift() ?? "done";
      },
      onRuntime: (runtime: { id: number } | null) => {
        events.push(`active:${runtime?.id ?? "none"}`);
      },
    },
  };
}

describe("managed initialization lifecycle", () => {
  it("stops the previous runtime before reconnecting after init and shuts down on exit", async () => {
    const { events, options } = fixture(["restart", "done"]);
    await runManagedSessions(options);
    expect(events).toEqual([
      "start:1",
      "active:1",
      "attach:1",
      "stop:1",
      "active:none",
      "start:2",
      "active:2",
      "attach:2",
      "stop:2",
      "active:none",
    ]);
  });

  it("does not restart when initialization preserves the effective config", async () => {
    const { events, options } = fixture(["done"]);
    await runManagedSessions(options);
    expect(events.filter((event) => event.startsWith("start:"))).toEqual(["start:1"]);
  });

  it("propagates restart failure after stopping the previous runtime", async () => {
    const { events, options } = fixture(["restart"], true);
    await expect(runManagedSessions(options)).rejects.toThrow("port unavailable");
    expect(events).toEqual(["start:1", "active:1", "attach:1", "stop:1", "active:none", "start:2"]);
  });

  it("cleans up if the attached session fails", async () => {
    const { events, options } = fixture([]);
    await expect(
      runManagedSessions({
        ...options,
        attach: async () => {
          throw new Error("IPC unavailable");
        },
      }),
    ).rejects.toThrow("IPC unavailable");
    expect(events).toContain("stop:1");
    expect(events.at(-1)).toBe("active:none");
  });
});
