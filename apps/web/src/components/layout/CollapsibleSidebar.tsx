import { type CSSProperties, type ReactNode, useEffect, useState } from "react";

const TRANSITION_MS = 200;
const SETTLE_MS = TRANSITION_MS + 20;

/**
 * Animated container for collapsible sidebars.
 *
 * The panel stays mounted while its width animates between 0 and `width`,
 * so expanding/collapsing never remounts the sidebar (the previous
 * conditional rendering produced hard cuts and lost scroll/focus state).
 * Avoids transforms on purpose: fixed-positioned popovers inside the
 * sidebars must keep the viewport as their containing block.
 */
export const CollapsibleSidebar = ({
  collapsed,
  side,
  width,
  children,
  className,
}: {
  collapsed: boolean;
  side: "left" | "right";
  width: number;
  children: ReactNode;
  className?: string;
}) => {
  // `restCollapsed` flips only after the transition settles, so the hidden
  // panel becomes invisible/inert exactly when the animation ends.
  const [restCollapsed, setRestCollapsed] = useState(collapsed);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    setAnimate(true);
    const timer = window.setTimeout(() => {
      setRestCollapsed(collapsed);
      setAnimate(false);
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [collapsed]);

  const innerWidth = `${Math.max(width, 0)}px`;
  const slideOffset = side === "left" ? "-16px" : "16px";

  const outerStyle: CSSProperties = {
    minWidth: 0,
    width: collapsed ? 0 : innerWidth,
    overflow: "hidden",
    visibility: restCollapsed && collapsed ? "hidden" : undefined,
    transition: animate
      ? `width ${TRANSITION_MS}ms ease-out, visibility ${TRANSITION_MS}ms`
      : undefined,
  };

  const innerStyle: CSSProperties = {
    width: innerWidth,
    opacity: restCollapsed ? 0 : 1,
    transform: restCollapsed ? `translateX(${slideOffset})` : "translateX(0px)",
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
