import { asc, desc, eq, max } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { newId } from "../../db/ids.js";
import { type ProjectRow, projects } from "../../db/schema.js";

export interface CreateProjectInput {
  name: string;
  rootPath: string;
  realPath: string;
  settingsJson: string;
  gitDetected: boolean;
  sortOrder?: number;
  now: number;
}

export function listProjects(db: DbExecutor): ProjectRow[] {
  return db
    .select()
    .from(projects)
    .orderBy(asc(projects.sortOrder), desc(projects.updatedAt), desc(projects.id))
    .all();
}

export function nextProjectSortOrder(db: DbExecutor): number {
  const row = db
    .select({ value: max(projects.sortOrder) })
    .from(projects)
    .get();
  return (row?.value ?? -1) + 1;
}

export function getProjectById(db: DbExecutor, id: string): ProjectRow | null {
  return db.select().from(projects).where(eq(projects.id, id)).get() ?? null;
}

export function findProjectByRealPath(db: DbExecutor, realPath: string): ProjectRow | null {
  return db.select().from(projects).where(eq(projects.realPath, realPath)).get() ?? null;
}

export function createProjectRow(db: DbExecutor, input: CreateProjectInput): ProjectRow {
  const row: ProjectRow = {
    id: newId("prj"),
    name: input.name,
    rootPath: input.rootPath,
    realPath: input.realPath,
    settingsJson: input.settingsJson,
    gitDetected: input.gitDetected,
    sortOrder: input.sortOrder ?? 0,
    createdAt: input.now,
    updatedAt: input.now,
  };

  db.insert(projects).values(row).run();
  return row;
}

export function updateProjectRow(
  db: DbExecutor,
  id: string,
  input: { name?: string; settingsJson?: string; gitDetected?: boolean; updatedAt: number },
): ProjectRow | null {
  const changes = {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.settingsJson === undefined ? {} : { settingsJson: input.settingsJson }),
    ...(input.gitDetected === undefined ? {} : { gitDetected: input.gitDetected }),
    updatedAt: input.updatedAt,
  };

  db.update(projects).set(changes).where(eq(projects.id, id)).run();
  return getProjectById(db, id);
}

export function updateProjectSortOrders(db: DbExecutor, orderedIds: string[]): void {
  for (const [index, id] of orderedIds.entries()) {
    db.update(projects).set({ sortOrder: index }).where(eq(projects.id, id)).run();
  }
}

export function deleteProjectRow(db: DbExecutor, id: string): boolean {
  return db.delete(projects).where(eq(projects.id, id)).run().changes > 0;
}
