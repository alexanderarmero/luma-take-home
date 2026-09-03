import { serve } from "@hono/node-server";
import { loadConfig } from "./config/config.js";
import { migrate } from "./db/migrate.js";
import { createPostgresClient } from "./db/postgres.js";
import { createApp } from "./slack/app.js";

const config = loadConfig(process.env);
const db = createPostgresClient(config.databaseUrl);

// Migrations run on boot and are idempotent, so a redeploy is safe and a
// fresh database needs no separate provisioning step.
const applied = await migrate(db);
if (applied.length > 0) {
  console.log(`[db] applied migrations: ${applied.join(", ")}`);
}

const app = createApp({
  signingSecret: config.slack.signingSecret,
  now: () => Date.now(),
  // Fire-and-forget for now. Ticket 05 replaces this with the durable job
  // table, because work that only exists in memory does not survive a restart.
  defer: (task) => {
    void task().catch((error) => {
      console.error("[defer] task failed", error);
    });
  },
  db,
});

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`[server] listening on :${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void db.close().finally(() => process.exit(0));
  });
}
