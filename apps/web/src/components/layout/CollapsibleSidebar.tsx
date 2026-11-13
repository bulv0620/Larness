import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";

const COLLAPSE_MS = 160;
const EXPAND_MS = 200;
const EASE_COLLAPSE = "cubic-bezier(0.32, 0, 0.8, 1)";
const EASE_EXPAND = "cubic-bezier(0.25, 0.65, 0.35, 1)";
const FADE_OUT_DELAY_MS = 40;

/**
 * Animated container for collapsible sidebars.
 *
 * The width/visibility/opacity transition is enabled only for the render in
 * which `collapsed` flips, and it must be applied with useLayoutEffect so the
 * transition property is part of the computed style *before* the browser
 * paints: a plain effect would run after paint and the width would snap
 * instead of animating. Outside of a collapse/expand the transition stays
 * off so dragging the resize handle tracks the pointer instantly.
 *
 * The panel stays mounted while its width animates between 0 and `width`,
 * so expanding/collapsing never remounts the sidebar (scroll position and
 * focus survive). Transforms are avoided on purpose: fixed-positioned
 * popovers inside the sidebars must keep the viewport as containing block.
 */
export const CollapsibleSidebar = ({
  collapsed,
  width,
  side = "left",
  children,
  className,
}: {
  collapsed: boolean;
  width: number;
  side?: "left" | "right";
  children: ReactNode;
  className?: string;
}) => {
  const previousCollapsed = useRef(collapsed);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    if (previousCollapsed.current === collapsed) {
      return;
    }
    previousCollapsed.current = collapsed;
    setAnimate(true);
    const duration = collapsed ? COLLAPSE_MS : EXPAND_MS;
    const timer = window.setTimeout(() => setAnimate(false), duration + 20);
    return () => window.clearTimeout(timer);
  }, [collapsed]);

  const innerWidth = `${Math.max(width, 0)}px`;
  // Transitioning `visibility` with a discrete 0s step keeps the panel
  // visible for the whole collapse animation and flips it hidden exactly at
  // the end; on expand it becomes visible immediately.
  const outerTransition = animate
    ? collapsed
      ? `width ${COLLAPSE_MS}ms ${EASE_COLLAPSE}, visibility 0s linear ${COLLAPSE_MS}ms`
      : `width ${EXPAND_MS}ms ${EASE_EXPAND}, visibility 0s linear 0s`
    : undefined;
  const innerTransition = animate
    ? collapsed
      ? `opacity ${COLLAPSE_MS - FADE_OUT_DELAY_MS}ms ease-in ${FADE_OUT_DELAY_MS}ms`
      : `opacity ${EXPAND_MS}ms ${EASE_EXPAND}`
    : undefined;

  const outerStyle: CSSProperties = {
    minWidth: 0,
    width: collapsed ? 0 : innerWidth,
    overflow: "hidden",
    visibility: collapsed ? "hidden" : "visible",
    transition: outerTransition,
  };

  const innerStyle: CSSProperties = {
    width: innerWidth,
    opacity: collapsed ? 0 : 1,
    transition: innerTransition,
  };

  return (
    <div
      aria-hidden={collapsed || undefined}
      inert={collapsed}
      className={`${side === "right" ? "justify-end" : ""} motion-reduce:transition-none! ${className ?? ""}`}
      style={outerStyle}
    >
      <div className="flex min-h-0 shrink-0 motion-reduce:transition-none!" style={innerStyle}>
        {children}
      </div>
    </div>
  );
};
