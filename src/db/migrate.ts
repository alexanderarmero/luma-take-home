import type { SqlClient } from "./client.js";
import { MIGRATIONS } from "./migrations.js";

/**
 * Applies any migrations this database has not seen. Safe to run on every
 * boot: already-applied migrations are skipped, so it is idempotent.
 */
export async function migrate(db: SqlClient): Promise<string[]> {
  await db.exec(`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const { rows } = await db.query<{ name: string }>(
    "select name from schema_migrations",
  );
  const applied = new Set(rows.map((r) => r.name));
  const ran: string[] = [];

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    await db.exec(migration.sql);
    await db.query("insert into schema_migrations (name) values ($1)", [
      migration.name,
    ]);
    ran.push(migration.name);
  }

  return ran;
}
