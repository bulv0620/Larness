import type { ManagedWindow, Rect, WindowKind } from "./windowTypes";

export const WINDOW_MIN_WIDTH = 420;
export const WINDOW_MIN_HEIGHT = 280;
const GAP = 8;

export const DEFAULT_WINDOW_SIZE: Record<WindowKind, { width: number; height: number }> = {
  files: { width: 760, height: 520 },
  terminal: { width: 680, height: 420 },
  services: { width: 620, height: 460 },
  browser: { width: 760, height: 540 },
  "git-diff": { width: 720, height: 480 },
};

export interface Viewport {
  width: number;
  height: number;
}

export function clampRect(rect: Rect, viewport: Viewport): Rect {
  const width = Math.max(
    WINDOW_MIN_WIDTH,
    Math.min(rect.width, Math.max(WINDOW_MIN_WIDTH, viewport.width - GAP * 2)),
  );
  const height = Math.max(
    WINDOW_MIN_HEIGHT,
    Math.min(rect.height, Math.max(WINDOW_MIN_HEIGHT, viewport.height - GAP * 2)),
  );
  const maxX = Math.max(GAP, viewport.width - width - GAP);
  const maxY = Math.max(GAP, viewport.height - height - GAP);
  return {
    width,
    height,
    x: Math.min(Math.max(GAP, rect.x), maxX),
    y: Math.min(Math.max(GAP, rect.y), maxY),
  };
}

export function defaultRect(kind: WindowKind, index: number, viewport: Viewport): Rect {
  const size = DEFAULT_WINDOW_SIZE[kind];
  const width = Math.min(size.width, viewport.width - GAP * 2);
  const height = Math.min(size.height, viewport.height - GAP * 2);
  const offset = (index % 5) * 28;
  return clampRect(
    {
      width,
      height,
      x: Math.max(GAP, viewport.width - width - 56 - offset),
      y: Math.max(GAP, 32 + offset),
    },
    viewport,
  );
}

export function maximizeRect(window: ManagedWindow): Rect {
  return window.restore ?? { x: window.x, y: window.y, width: window.width, height: window.height };
}

export function titleBarReachable(rect: Rect, viewport: Viewport): boolean {
  return (
    rect.x + 80 >= 0 &&
    rect.x <= viewport.width - 80 &&
    rect.y >= 0 &&
    rect.y <= viewport.height - 40
  );
}
