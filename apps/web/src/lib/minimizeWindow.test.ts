import { afterEach, expect, it, vi } from "vitest";
import { animateMinimize, cancelMinimize } from "./minimizeWindow";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});
it("waits for the shrink animation and cancels it on restore", async () => {
  document.body.innerHTML = '<div data-window-frame="w"></div><nav aria-label="项目窗口"></nav>';
  const frame = document.querySelector("div");
  if (!frame) throw new Error("missing");
  let done: (() => void) | undefined;
  const animation = {
    finished: new Promise<void>((resolve) => {
      done = resolve;
    }),
    cancel: vi.fn(),
  };
  Object.assign(frame, { animate: vi.fn(() => animation) });
  const finish = vi.fn();
  animateMinimize("w", finish);
  expect(finish).not.toHaveBeenCalled();
  cancelMinimize("w");
  done?.();
  await animation.finished;
  await Promise.resolve();
  expect(finish).not.toHaveBeenCalled();
  expect(animation.cancel).toHaveBeenCalled();
});
it("skips animation for reduced motion", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const finish = vi.fn();
  animateMinimize("missing", finish);
  expect(finish).toHaveBeenCalledOnce();
});
