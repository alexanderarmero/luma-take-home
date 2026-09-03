/**
 * The minimum surface the application needs from Postgres.
 *
 * Both `pg.Pool` (production) and PGlite (tests) satisfy this, so tests run
 * against real Postgres semantics without a container. The application never
 * sees which one it has.
 */
export interface SqlClient {
  /** Single parameterised statement. */
  query<R = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;

  /**
   * Multi-statement script with no parameters, for DDL.
   *
   * Separate from `query` because the extended protocol permits only one
   * statement per call — a migration file needs the simple protocol.
   */
  exec(sql: string): Promise<void>;
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export async function inTransaction<T>(
  db: SqlClient,
  fn: (tx: SqlClient) => Promise<T>,
): Promise<T> {
  await db.query("begin");
  try {
    const result = await fn(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}
