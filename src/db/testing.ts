import { PGlite } from "@electric-sql/pglite";
import type { SqlClient } from "./client.js";
import { migrate } from "./migrate.js";

export type TestDb = SqlClient & { close(): Promise<void> };

/**
 * A real Postgres, in-process, migrated and empty.
 *
 * Several invariants in this system *are* queries — retrieval reading through
 * the delivered pointer, completion as two counts against a batch size,
 * decision state as membership. Faking the database would fake exactly the
 * things worth asserting, so tests run against the real engine.
 */
export async function createTestDb(): Promise<TestDb> {
  const pglite = new PGlite();
  const db: SqlClient = {
    query: (text, params) => pglite.query(text, params as never[]) as never,
    exec: async (sql) => {
      await pglite.exec(sql);
    },
  };
  await migrate(db);
  return Object.assign(db, { close: () => pglite.close() });
}
