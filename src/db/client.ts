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
   * statement per call — a migration script needs the simple protocol.
   */
  exec(sql: string): Promise<void>;

  /**
   * Runs `fn` against a single connection wrapped in BEGIN/COMMIT, rolling
   * back if it throws.
   *
   * This belongs to the adapter, not to a helper over `query`. A pool hands
   * out a different connection per `query` call, so issuing BEGIN, the body,
   * and COMMIT as separate calls does not produce a transaction — it produces
   * three autocommitted statements and one connection left idle-in-transaction
   * for the next unlucky caller to inherit.
   */
  transaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
}
