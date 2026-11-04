const pending = new Map<string, Animation>();
export function cancelMinimize(id: string) {
  pending.get(id)?.cancel();
  pending.delete(id);
}
export function animateMinimize(id: string, complete: () => void) {
  if (pending.has(id)) return;
  const frame = document.querySelector<HTMLElement>(`[data-window-frame="${CSS.escape(id)}"]`);
  const dock = document.querySelector<HTMLElement>('[aria-label="项目窗口"]');
  if (!frame?.animate || !dock || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    complete();
    return;
  }
  const from = frame.getBoundingClientRect(),
    to = dock.getBoundingClientRect();
  const current = getComputedStyle(frame).transform;
  const base = current && current !== "none" ? `${current} ` : "";
  const animation = frame.animate(
    [
      { transform: `${base}translate(0, 0) scale(1)`, opacity: 1 },
      {
        transform: `${base}translate(${to.x + to.width / 2 - from.x - from.width / 2}px, ${to.y + to.height / 2 - from.y - from.height / 2}px) scale(.08)`,
        opacity: 0,
      },
    ],
    { duration: 200, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
  );
  pending.set(id, animation);
  void animation.finished
    .then(() => {
      if (pending.get(id) === animation) complete();
    })
    .catch(() => {})
    .finally(() => {
      if (pending.get(id) === animation) pending.delete(id);
      animation.cancel();
    });
}
