import type { Database, DbExecutor } from "./client.js";

export function immediateTransaction<T>(db: Database, run: (tx: DbExecutor) => T): T {
  return db.transaction((tx) => run(tx), { behavior: "immediate" });
}
