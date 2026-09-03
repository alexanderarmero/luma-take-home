import pg from "pg";
import type { SqlClient } from "./client.js";

/** Wraps a checked-out client so every statement in a transaction shares it. */
function clientBound(client: pg.PoolClient): SqlClient {
  const bound: SqlClient = {
    query: (text, params) => client.query(text, params as never[]) as never,
    exec: async (sql) => {
      await client.query(sql);
    },
    // Already inside a transaction; reuse it rather than nesting.
    transaction: (fn) => fn(bound),
  };
  return bound;
}

/**
 * Production adapter. `pool.query` with no parameters uses the simple
 * protocol, which accepts the multi-statement scripts `exec` is for.
 */
export function createPostgresClient(connectionString: string): SqlClient & {
  close(): Promise<void>;
} {
  const pool = new pg.Pool({ connectionString });

  return {
    query: (text, params) => pool.query(text, params as never[]) as never,
    exec: async (sql) => {
      await pool.query(sql);
    },
    transaction: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(clientBound(client));
        await client.query("commit");
        return result;
      } catch (error) {
        // Best-effort: if the connection itself died, the rollback will too,
        // and releasing it is what actually matters.
        await client.query("rollback").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
