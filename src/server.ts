import { serve } from "@hono/node-server";
import { loadConfig } from "./config/config.js";
import { createDbBootstrap } from "./db/bootstrap.js";
import { createPostgresClient } from "./db/postgres.js";
import { describeDatabaseUrl } from "./db/redact.js";
import { createApp } from "./slack/app.js";
import { createLumaGenerator } from "./generation/generator.js";
import { createPromptWriter } from "./generation/prompts.js";
import { startWorkerLoop } from "./generation/loop.js";
import { createSlackClient } from "./slack/client.js";
import { createS3ObjectStore } from "./storage/s3.js";

const config = loadConfig(process.env);
const db = createPostgresClient(config.databaseUrl);
const dbBootstrap = createDbBootstrap(db);

const slack = createSlackClient({ botToken: config.slack.botToken });
const generator = createLumaGenerator({ authToken: config.lumaApiKey });
const store = createS3ObjectStore(config.storage);

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
  slack,
  reviewChannelId: config.slack.reviewChannelId,
  approverUserId: config.slack.approverUserId,
  generator,
  store,
  publicBaseUrl: config.publicBaseUrl,
  ...(config.anthropicApiKey
    ? {
        promptWriterFor: (brand, direction) =>
          createPromptWriter({ apiKey: config.anthropicApiKey!, brand, direction }),
      }
    : {}),
});

// The HTTP server comes up first, deliberately.
//
// Migrating before serving means an unreachable database kills the process
// before /healthz exists — the service is then down *and* undiagnosable, which
// is how "everything times out at once" happens with no way to see why.
// Now the health endpoint answers immediately and says what the database is
// doing, and a private network that is not routable for the first few seconds
// of a container's life is a retry rather than a crash.
const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  // What was missing while debugging the first deploy: which interface and
  // port we actually bound, and which database we are dialling. A port that
  // does not match the platform's routing looks identical to a crash from the
  // outside, and the logs should be able to tell them apart on their own.
  console.log(
    `[server] listening on ${info.address}:${info.port} (${info.family})`,
  );
  console.log(`[db] target ${describeDatabaseUrl(config.databaseUrl)}`);
  void dbBootstrap.start().then(() => {
    // The pipeline runs here, not inside the request that started it. Work
    // lives in the job table, so a restart loses time and nothing else — the
    // next tick picks up generations submitted by a process that is gone.
    startWorkerLoop(
      {
        db,
        generator,
        store,
        slack,
        channel: config.slack.reviewChannelId,
        publicBaseUrl: config.publicBaseUrl,
        model: "uni-1-max",
        aspectRatio: "1:1",
        log: (message) => console.log(message),
      },
      {
        approverUserId: config.slack.approverUserId,
        publicBaseUrl: config.publicBaseUrl,
      },
    );
    console.log("[worker] loop started");
  });
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
