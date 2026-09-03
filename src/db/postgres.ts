import pg from "pg";
import type { SqlClient } from "./client.js";

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
    close: () => pool.end(),
  };
}
