import type { Project } from "@larness/shared";

/**
 * Moves a project id to an insertion slot in the ordered id list. The slot is
 * expressed against the original list: slot 0 inserts before the first item,
 * slot `ids.length` inserts after the last item.
 */
export function moveProjectId(ids: string[], id: string, slot: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return ids;

  const clamped = Math.max(0, Math.min(slot, ids.length));
  const insertAt = clamped > from ? clamped - 1 : clamped;
  if (insertAt === from) return ids;

  const next = [...ids];
  next.splice(from, 1);
  next.splice(insertAt, 0, id);
  return next;
}

/**
 * Applies a registered-project order while keeping the built-in default
 * workspace first. Projects missing from `orderedIds` are appended in their
 * current order instead of being dropped.
 */
export function applyProjectOrder(projects: Project[], orderedIds: string[]): Project[] {
  const byId = new Map(projects.map((project) => [project.id, project]));
  const ordered = orderedIds
    .map((id) => byId.get(id))
    .filter((project): project is Project => project !== undefined);
  const orderedIdsSet = new Set(orderedIds);

  return [
    ...projects.filter((project) => project.kind === "default"),
    ...ordered,
    ...projects.filter((project) => project.kind !== "default" && !orderedIdsSet.has(project.id)),
  ];
}
