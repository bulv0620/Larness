/**
 * No-progress detection is a pause signal, not a task budget (ADR-071).
 * A non-positive timeout disables the check.
 */
export function isStalled(lastProgressAt: number, now: number, timeoutMs: number): boolean {
  return timeoutMs > 0 && now - lastProgressAt > timeoutMs;
}
