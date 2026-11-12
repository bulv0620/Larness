import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef } from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "./cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  children,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  const listRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState({ left: 0, width: 0, visible: false });

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const active = list.querySelector<HTMLElement>("[data-state='active']");
      if (!active) {
        setThumb((prev) => (prev.visible ? { ...prev, visible: false } : prev));
        return;
      }
      const next = { left: active.offsetLeft, width: active.offsetWidth, visible: true };
      setThumb((prev) =>
        prev.visible && prev.left === next.left && prev.width === next.width ? prev : next,
      );
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(list);
    for (const node of Array.from(list.children)) resize.observe(node);
    const state = new MutationObserver(measure);
    state.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    return () => {
      resize.disconnect();
      state.disconnect();
    };
  }, []);

  return (
    <TabsPrimitive.List
      ref={listRef}
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-[9px] bg-surface-3 p-0.5",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0.5 left-0 rounded-[7px] bg-surface shadow-sm ring-1 ring-inset ring-line-strong/40",
          "transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.34,1.3,0.44,1)] motion-reduce:transition-none",
          thumb.visible ? "opacity-100" : "scale-[0.96] opacity-0",
        )}
        style={{ width: thumb.width, transform: `translate3d(${thumb.left}px,0,0)` }}
      />
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative inline-flex h-6 items-center rounded-[7px] px-2 text-[11.5px] font-medium text-ink-2 outline-none transition-colors",
        "data-[state=active]:text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("outline-none", className)} {...props} />;
}
