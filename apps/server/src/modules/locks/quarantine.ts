import { isInsideRoot } from "@larness/resources";

// A failed SQLite write must not reopen a root whose writer could not be reconciled.
// Durable operations / startup reconciliation carry the barrier across restarts.
const roots = new Map<string, string>();
export function quarantineRoot(operationId: string, root: string) {
  roots.set(operationId, root);
}
export function clearRootQuarantine(operationId: string) {
  roots.delete(operationId);
}
export function rootIsQuarantined(root: string) {
  return [...roots.values()].some(
    (other) => isInsideRoot(root, other) || isInsideRoot(other, root),
  );
}
export function quarantinedRoots(): string[] {
  return [...new Set(roots.values())];
}
