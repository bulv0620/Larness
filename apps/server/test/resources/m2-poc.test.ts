import { describe, expect, it } from "vitest";
import { probeFiles, probeProcesses, probePty, probeRoots } from "../../scripts/m2-poc/probes.js";

describe.skipIf(process.platform !== "darwin")("M2-0 real macOS resource feasibility", () => {
  it("uses a real PTY for input, resize, interrupt and confirmed termination", async () => {
    expect(await probePty()).toEqual({
      input: true,
      resize: true,
      interrupt: true,
      stopped: true,
      processTreeStopped: true,
    });
  }, 20_000);

  it("cleans process groups on cancel, timeout, lease loss and supervisor exit", async () => {
    expect(await probeProcesses()).toEqual({
      cancel: true,
      timeout: true,
      leaseLoss: true,
      supervisorExit: true,
      unknownIdentityBlocked: true,
    });
  }, 30_000);

  it("rejects file replacement and outside symlinks, detects watcher loss and rescans", async () => {
    expect(await probeFiles()).toEqual({
      identity: true,
      version: true,
      atomicReplace: true,
      outsideLinkRejected: true,
      watcher: true,
      overflowRescan: true,
      externalRaceDemonstrated: true,
      watcherLimit: true,
    });
  }, 20_000);

  it("persists root conflicts and blocks expired unknown writers across reopen", async () => {
    expect(await probeRoots()).toEqual({
      overlap: true,
      disjoint: true,
      restartBlocked: true,
      staleFenceRejected: true,
    });
  });
});
