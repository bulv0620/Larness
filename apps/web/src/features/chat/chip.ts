/**
 * One tag shape for everything that names a file inside the timeline: session
 * attachments and turn artifacts share these tokens so the two never drift.
 * Callers only add what makes them different (fixed width, remove button).
 */
export const chipClass =
  "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-line/80 bg-surface-2/55 px-2 text-[11px] text-ink-2";

export const chipInteractiveClass =
  "transition-colors hover:border-accent/35 hover:bg-accent-soft/30 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-55";
