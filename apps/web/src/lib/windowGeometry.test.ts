import { describe, expect, it } from "vitest";
import { clampRect, defaultRect, WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH } from "./windowGeometry";

const viewport = { width: 1440, height: 852 };

describe("windowGeometry", () => {
  it("clamps a window dragged outside the viewport", () => {
    const rect = clampRect({ x: -200, y: -100, width: 700, height: 500 }, viewport);
    expect(rect.x).toBeGreaterThanOrEqual(8);
    expect(rect.y).toBeGreaterThanOrEqual(8);
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
  });

  it("enforces minimum size", () => {
    const rect = clampRect({ x: 10, y: 10, width: 100, height: 80 }, viewport);
    expect(rect.width).toBeGreaterThanOrEqual(WINDOW_MIN_WIDTH);
    expect(rect.height).toBeGreaterThanOrEqual(WINDOW_MIN_HEIGHT);
  });

  it("caps oversized windows to the viewport", () => {
    const rect = clampRect({ x: 10, y: 10, width: 4000, height: 3000 }, viewport);
    expect(rect.width).toBeLessThanOrEqual(viewport.width);
    expect(rect.height).toBeLessThanOrEqual(viewport.height);
  });

  it("cascades default windows", () => {
    const first = defaultRect("terminal", 0, viewport);
    const second = defaultRect("terminal", 1, viewport);
    expect(first).not.toEqual(second);
    expect(first.x).toBeGreaterThanOrEqual(8);
    expect(first.y).toBeGreaterThanOrEqual(8);
  });
});
