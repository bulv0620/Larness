import { describe, expect, it } from "vitest";
import { TurnQueue } from "../../src/modules/agent/queue.js";

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("condition not met in time");
}

function fakeRunner(delayMs = 20) {
  const order: string[] = [];
  const cancelled: string[] = [];
  let stopped = false;

  return {
    order,
    cancelled,
    isStopped: () => stopped,
    runner: {
      async run(turnId: string) {
        order.push(`start:${turnId}`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        order.push(`end:${turnId}`);
        return { status: "COMPLETED" as const };
      },
      cancel(turnId: string) {
        cancelled.push(turnId);
        return true;
      },
      stop() {
        stopped = true;
      },
    },
  };
}

describe("TurnQueue", () => {
  it("runs globally concurrently but serializes turns per session", async () => {
    const fake = fakeRunner(20);
    const queue = new TurnQueue({ runner: fake.runner, maxConcurrent: 2 });

    queue.enqueue("t1", "s1");
    queue.enqueue("t2", "s1");
    queue.enqueue("t3", "s2");

    await waitFor(() => queue.activeCount() === 0 && queue.pendingCount() === 0);

    expect(fake.order.indexOf("end:t1")).toBeLessThan(fake.order.indexOf("start:t2"));
    expect(fake.order.indexOf("start:t3")).toBeLessThan(fake.order.indexOf("end:t1"));
  });

  it("honours the global concurrency limit", async () => {
    const fake = fakeRunner(20);
    const queue = new TurnQueue({ runner: fake.runner, maxConcurrent: 1 });

    queue.enqueue("t1", "s1");
    queue.enqueue("t2", "s2");
    await waitFor(() => queue.activeCount() === 1);
    expect(fake.order).toEqual(["start:t1"]);

    await waitFor(() => queue.activeCount() === 0 && queue.pendingCount() === 0);
    expect(fake.order).toEqual(["start:t1", "end:t1", "start:t2", "end:t2"]);
  });

  it("delegates cancel and waits for running work on stop", async () => {
    const fake = fakeRunner(30);
    const queue = new TurnQueue({ runner: fake.runner, maxConcurrent: 1 });

    queue.enqueue("t1", "s1");
    expect(queue.cancel("t1")).toBe(true);
    expect(fake.cancelled).toEqual(["t1"]);

    await waitFor(() => queue.activeCount() === 1);
    await queue.stop();
    expect(fake.isStopped()).toBe(true);
    expect(queue.activeCount()).toBe(0);
    expect(fake.order).toContain("end:t1");
  });
});
