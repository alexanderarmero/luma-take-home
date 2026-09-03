import { serve } from "@hono/node-server";
import { loadConfig } from "./config/config.js";
import { createApp } from "./slack/app.js";

const config = loadConfig(process.env);

const app = createApp({
  signingSecret: config.slack.signingSecret,
  now: () => Date.now(),
  // Fire-and-forget for now. Ticket 03 replaces this with a durable job table,
  // because work that only exists in memory does not survive a restart.
  defer: (task) => {
    void task().catch((error) => {
      console.error("[defer] task failed", error);
    });
  },
});

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`[server] listening on :${port}`);
});
