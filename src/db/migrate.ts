import type { SqlClient } from "./client.js";
import { MIGRATIONS } from "./migrations.js";

/** Arbitrary but fixed: any two instances must pick the same number. */
const MIGRATION_LOCK_KEY = 8_675_309;

/**
 * Applies any migrations this database has not seen.
 *
 * Everything happens inside one transaction holding an advisory lock, which
 * buys two properties that matter on a real deploy:
 *
 *  - **Atomic.** DDL and its bookkeeping row commit together. A crash between
 *    them would otherwise leave tables that exist but are unrecorded, and the
 *    next boot would re-run the migration, fail on "relation already exists",
 *    and crash-loop until someone hand-inserted the row.
 *  - **Serialised.** A rolling deploy can start a second instance before the
 *    first is up. Without the lock both read an empty applied-set and both
 *    run the same migration; the loser dies.
 *
 * `pg_advisory_xact_lock` releases automatically when the transaction ends,
 * including on failure, so a crash cannot strand the lock.
 */
export async function migrate(db: SqlClient): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);

    await tx.exec(`
      create table if not exists schema_migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      );
    `);

    const { rows } = await tx.query<{ name: string }>(
      "select name from schema_migrations",
    );
    const applied = new Set(rows.map((r) => r.name));
    const ran: string[] = [];

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.name)) continue;
      await tx.exec(migration.sql);
      await tx.query("insert into schema_migrations (name) values ($1)", [
        migration.name,
      ]);
      ran.push(migration.name);
    }

    return ran;
  });
}
