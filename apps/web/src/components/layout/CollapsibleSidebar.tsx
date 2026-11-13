import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from "react";

// Collapse accelerates out, expand decelerates into place: the asymmetric
// curves read as snappier than a symmetric ease-out even at the same duration.
const COLLAPSE_MS = 150;
const EXPAND_MS = 150;
const EASE_COLLAPSE = "cubic-bezier(0.4, 0, 1, 1)";
const EASE_EXPAND = "cubic-bezier(0.22, 1, 0.36, 1)";
// Content fades on its own (shorter) timeline so it clearly reads as a fade
// while the panel is collapsing, and re-appears early during expand.
const FADE_OUT_MS = 90;
const FADE_IN_MS = 120;
const SETTLE_MS = Math.max(COLLAPSE_MS, EXPAND_MS, FADE_OUT_MS, FADE_IN_MS) + 20;

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
  // Transitioning `visibility` with a discrete 0s step keeps the panel
  // visible for the whole collapse animation and flips it hidden exactly at
  // the end; on expand it becomes visible immediately.
  const outerTransition = animate
    ? collapsed
      ? `width ${COLLAPSE_MS}ms ${EASE_COLLAPSE}, visibility 0s linear ${COLLAPSE_MS}ms`
      : `width ${EXPAND_MS}ms ${EASE_EXPAND}, visibility 0s linear 0s`
    : undefined;
  const innerTransition = animate
    ? `opacity ${collapsed ? FADE_OUT_MS : FADE_IN_MS}ms ease-out`
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
    <div aria-hidden={collapsed || undefined} className={className} style={outerStyle}>
      <div className="shrink-0" style={innerStyle}>
        {children}
      </div>
    </div>
  );
};
