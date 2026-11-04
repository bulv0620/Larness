import { afterEach, expect, it, vi } from "vitest";
import { useWindowStore } from "@/stores/windowStore";
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
  frame.style.transform = "translate(123px, 45px)";
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
  expect(vi.mocked(frame.animate).mock.calls[0]?.[0]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ transform: "translate(123px, 45px) translate(0, 0) scale(1)" }),
    ]),
  );
  cancelMinimize("w");
  done?.();
  await animation.finished;
  await Promise.resolve();
  expect(finish).not.toHaveBeenCalled();
  expect(animation.cancel).toHaveBeenCalled();
});
it("skips animation for reduced motion", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  document.body.innerHTML =
    '<div data-window-frame="reduced"></div><nav aria-label="项目窗口"></nav>';
  const frame = document.querySelector("div");
  if (!frame) throw new Error("missing");
  const animate = vi.fn();
  Object.assign(frame, { animate });
  const finish = vi.fn();
  animateMinimize("reduced", finish);
  expect(finish).toHaveBeenCalledOnce();
  expect(animate).not.toHaveBeenCalled();
});

it("reopening a resource cancels an in-flight minimize instead of hiding it later", async () => {
  useWindowStore.setState({ windows: [], focusedId: null });
  const input = {
    kind: "terminal" as const,
    resourceId: "term_fixture",
    title: "terminal",
    projectId: "p",
  };
  useWindowStore.getState().open(input);
  const win = useWindowStore.getState().windows[0];
  if (!win) throw new Error("missing");
  document.body.innerHTML = `<div data-window-frame="${win.id}"></div><nav aria-label="项目窗口"></nav>`;
  const frame = document.querySelector("div");
  if (!frame) throw new Error("missing");
  let resolve: (() => void) | undefined;
  const animation = {
    finished: new Promise<void>((done) => {
      resolve = done;
    }),
    cancel: vi.fn(),
  };
  Object.assign(frame, { animate: vi.fn(() => animation) });
  useWindowStore.getState().hide(win.id);
  useWindowStore.getState().open(input);
  resolve?.();
  await animation.finished;
  await Promise.resolve();
  expect(useWindowStore.getState().windows[0]?.minimized).toBe(false);
  expect(animation.cancel).toHaveBeenCalled();
});
