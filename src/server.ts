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

const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`[server] listening on :${port}`);
});

// On a rolling deploy the platform sends SIGTERM while requests are still in
// flight. Ending the pool first would abort them mid-response and show the
// user a failed command instead of letting it finish.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} — draining`);
    server.close(() => {
      void db.close().finally(() => process.exit(0));
    });
    // Backstop: never hang a deploy on a stuck connection.
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
