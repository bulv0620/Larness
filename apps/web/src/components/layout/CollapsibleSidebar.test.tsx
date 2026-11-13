import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollapsibleSidebar } from "./CollapsibleSidebar";

const sidebarUi = (collapsed: boolean) => (
  <CollapsibleSidebar collapsed={collapsed} width={260}>
    <div>panel content</div>
  </CollapsibleSidebar>
);

// happy-dom may normalize the `transition` shorthand into longhand
// properties, so assert against all the places the value can land.
const transitionStyle = (element: HTMLElement) =>
  [
    element.style.transition,
    element.style.transitionProperty,
    element.style.transitionDuration,
  ].join(" ");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CollapsibleSidebar", () => {
  it("keeps children mounted and un-reflowed while collapsed", () => {
    const { getByText, container } = render(sidebarUi(true));
    const outer = container.firstElementChild as HTMLElement;
    const inner = outer.firstElementChild as HTMLElement;

    expect(getByText("panel content")).toBeTruthy();
    expect(outer.style.width).toBe("0px");
    expect(outer.style.visibility).toBe("hidden");
    expect(outer.getAttribute("aria-hidden")).toBe("true");
    expect(inner.style.width).toBe("260px");
  });

  it("applies the transition in the same commit the collapse flips", () => {
    const { rerender, container, getByText } = render(sidebarUi(false));
    const outer = container.firstElementChild as HTMLElement;
    const inner = outer.firstElementChild as HTMLElement;
    expect(outer.style.width).toBe("260px");
    expect(outer.style.visibility).toBe("visible");

    rerender(sidebarUi(true));

    // The width must already be 0 while the transition property is present:
    // adding the transition in a later effect would snap instead of animate.
    expect(outer.style.width).toBe("0px");
    expect(transitionStyle(outer)).toContain("width");
    expect(transitionStyle(outer)).toContain("160ms");
    // Keep content visible at the start and finish the fade with the width.
    expect(transitionStyle(inner)).toContain("120ms");
    expect(inner.style.transition + inner.style.transitionDelay).toContain("40ms");
    expect(inner.style.opacity).toBe("0");
    expect(inner.style.width).toBe("260px");
    expect(getByText("panel content")).toBeTruthy();
  });

  it("animates the expand and drops the transition after it settles", () => {
    vi.useFakeTimers();
    const { rerender, container } = render(sidebarUi(true));
    const outer = container.firstElementChild as HTMLElement;
    const inner = outer.firstElementChild as HTMLElement;

    expect(outer.style.width).toBe("0px");
    expect(outer.style.visibility).toBe("hidden");

    rerender(sidebarUi(false));
    expect(outer.style.width).toBe("260px");
    expect(outer.style.visibility).toBe("visible");
    expect(transitionStyle(outer)).toContain("200ms");
    expect(transitionStyle(inner)).toContain("200ms");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(outer.style.width).toBe("260px");
    expect(transitionStyle(outer)).not.toContain("200ms");
  });
});
