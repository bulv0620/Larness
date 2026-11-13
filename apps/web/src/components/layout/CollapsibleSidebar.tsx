import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";

const TRANSITION_MS = 200;
const SETTLE_MS = TRANSITION_MS + 20;

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
  children,
  className,
}: {
  collapsed: boolean;
  width: number;
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
    const timer = window.setTimeout(() => setAnimate(false), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [collapsed]);

  const innerWidth = `${Math.max(width, 0)}px`;
  // Transitioning `visibility` keeps the panel visible for the whole collapse
  // animation and flips it hidden exactly at the end; on expand it becomes
  // visible immediately.
  const transition = animate
    ? `width ${TRANSITION_MS}ms ease-out, visibility ${TRANSITION_MS}ms`
    : undefined;

  const outerStyle: CSSProperties = {
    minWidth: 0,
    width: collapsed ? 0 : innerWidth,
    overflow: "hidden",
    visibility: collapsed ? "hidden" : "visible",
    transition,
  };

  const innerStyle: CSSProperties = {
    width: innerWidth,
    opacity: collapsed ? 0 : 1,
    transition: animate ? `opacity ${TRANSITION_MS}ms ease-out` : undefined,
  };

  return (
    <div aria-hidden={collapsed || undefined} className={className} style={outerStyle}>
      <div className="shrink-0" style={innerStyle}>
        {children}
      </div>
    </div>
  );
};
