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
 *
 * Note the honest limit: PGlite is a single connection, so it cannot expose
 * pooling bugs. `createPostgresClient`'s transaction handling is covered
 * separately in postgres.test.ts.
 */
export async function createTestDb(): Promise<TestDb> {
  const pglite = new PGlite();

  const db: SqlClient = {
    query: (text, params) => pglite.query(text, params as never[]) as never,
    exec: async (sql) => {
      await pglite.exec(sql);
    },
    transaction: async (fn) => {
      await pglite.query("begin");
      try {
        const result = await fn(db);
        await pglite.query("commit");
        return result;
      } catch (error) {
        await pglite.query("rollback").catch(() => {});
        throw error;
      }
    },
  };

  await migrate(db);
  return Object.assign(db, { close: () => pglite.close() });
}
