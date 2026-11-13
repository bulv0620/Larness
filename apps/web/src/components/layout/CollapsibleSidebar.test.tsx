import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollapsibleSidebar } from "./CollapsibleSidebar";

const sidebarUi = (collapsed: boolean) => (
  <CollapsibleSidebar collapsed={collapsed} side="left" width={260}>
    <div>panel content</div>
  </CollapsibleSidebar>
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CollapsibleSidebar", () => {
  it("keeps children mounted while the width animates to zero", () => {
    vi.useFakeTimers();
    const { rerender, container, getByText } = render(sidebarUi(false));
    const outer = container.firstElementChild as HTMLElement;
    const inner = outer.firstElementChild as HTMLElement;

    expect(getByText("panel content")).toBeTruthy();
    expect(outer.style.width).toBe("260px");

    rerender(sidebarUi(true));

    expect(getByText("panel content")).toBeTruthy();
    expect(outer.style.width).toBe("0px");
    expect(outer.getAttribute("aria-hidden")).toBe("true");
    expect(inner.style.width).toBe("260px");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(getByText("panel content")).toBeTruthy();
  });

  it("cuts visibility only after the collapse transition settles", () => {
    vi.useFakeTimers();
    const { rerender, container } = render(sidebarUi(false));
    const outer = container.firstElementChild as HTMLElement;

    rerender(sidebarUi(true));
    expect(outer.style.visibility).toBe("");

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(outer.style.visibility).toBe("hidden");
    expect(outer.style.width).toBe("0px");
  });

  it("restores visibility immediately when expanded again", () => {
    vi.useFakeTimers();
    const { rerender, container } = render(sidebarUi(true));
    const outer = container.firstElementChild as HTMLElement;

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(outer.style.visibility).toBe("hidden");

    rerender(sidebarUi(false));
    expect(outer.style.visibility).toBe("");
    expect(outer.style.width).toBe("260px");
  });
});
