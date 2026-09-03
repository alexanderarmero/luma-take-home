import { serve } from "@hono/node-server";
import { loadConfig } from "./config/config.js";
import { createDbBootstrap } from "./db/bootstrap.js";
import { createPostgresClient } from "./db/postgres.js";
import { createApp } from "./slack/app.js";

const config = loadConfig(process.env);
const db = createPostgresClient(config.databaseUrl);
const dbBootstrap = createDbBootstrap(db);

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
  dbStatus: dbBootstrap.status,
});

// The HTTP server comes up first, deliberately.
//
// Migrating before serving means an unreachable database kills the process
// before /healthz exists — the service is then down *and* undiagnosable, which
// is how "everything times out at once" happens with no way to see why.
// Now the health endpoint answers immediately and says what the database is
// doing, and a private network that is not routable for the first few seconds
// of a container's life is a retry rather than a crash.
const server = serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`[server] listening on :${port}`);
  void dbBootstrap.start();
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
