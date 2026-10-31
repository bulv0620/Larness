import { useCallback, useRef, useState } from "react";

export interface SectionState {
  id: string;
  title: string;
  size: number;
  expanded: boolean;
}

const MIN_HEIGHT = 96;

export function useSectionResizer(initial: SectionState[]) {
  const [sections, setSections] = useState(initial);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    index: number;
    startY: number;
    startA: number;
    startB: number;
    height: number;
  } | null>(null);

  const toggle = useCallback((id: string) => {
    setSections((current) =>
      current.map((section) =>
        section.id === id ? { ...section, expanded: !section.expanded } : section,
      ),
    );
  }, []);

  const onPointerDown = useCallback(
    (index: number, event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const height = container.clientHeight;
      const a = sections[index];
      const b = sections[index + 1];
      if (!a || !b) return;
      dragRef.current = {
        index,
        startY: event.clientY,
        startA: a.size,
        startB: b.size,
        height,
      };

      const onMove = (move: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const delta = (move.clientY - drag.startY) / Math.max(1, drag.height);
        const min = MIN_HEIGHT / Math.max(1, drag.height);
        const nextA = Math.max(min, drag.startA + delta);
        const nextB = Math.max(min, drag.startB - delta);
        setSections((current) =>
          current.map((section, i) =>
            i === drag.index
              ? { ...section, size: nextA }
              : i === drag.index + 1
                ? { ...section, size: nextB }
                : section,
          ),
        );
      };

      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [sections],
  );

  const equalize = useCallback((index: number) => {
    setSections((current) => {
      const a = current[index];
      const b = current[index + 1];
      if (!a || !b) return current;
      const total = a.size + b.size;
      return current.map((section, i) =>
        i === index
          ? { ...section, size: total / 2 }
          : i === index + 1
            ? { ...section, size: total / 2 }
            : section,
      );
    });
  }, []);

  const nudge = useCallback((index: number, deltaPx: number) => {
    const height = containerRef.current?.clientHeight ?? 600;
    const delta = deltaPx / height;
    setSections((current) => {
      const a = current[index];
      const b = current[index + 1];
      if (!a || !b) return current;
      const min = MIN_HEIGHT / height;
      const nextA = Math.max(min, a.size + delta);
      const nextB = Math.max(min, b.size - delta);
      return current.map((section, i) =>
        i === index
          ? { ...section, size: nextA }
          : i === index + 1
            ? { ...section, size: nextB }
            : section,
      );
    });
  }, []);

  return { sections, containerRef, toggle, onPointerDown, equalize, nudge };
}
