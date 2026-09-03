import { Hono } from "hono";
import { verifySlackSignature } from "./signature.js";

export interface AppDeps {
  signingSecret: string;
  /** Injected so replay-window behaviour is testable without freezing time. */
  now: () => number;
  /**
   * Runs work after the response has been sent. Slack drops any request not
   * acknowledged within three seconds, so no handler may await real work.
   */
  defer: (task: () => Promise<void>) => void;
}

const USAGE = [
  "Commands I know:",
  "• `/luma ping` — check I'm awake",
].join("\n");

/** Slack renders this only to the person who typed the command. */
function ephemeral(text: string) {
  return { response_type: "ephemeral" as const, text };
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ status: "ok" }));

  app.post("/slack/commands", async (c) => {
    // The signature covers the exact bytes Slack sent. Parsing first and
    // re-serialising would change them, so the raw body is read up front.
    const raw = await c.req.text();

    const verified = verifySlackSignature({
      body: raw,
      headers: {
        "x-slack-request-timestamp": c.req.header("x-slack-request-timestamp"),
        "x-slack-signature": c.req.header("x-slack-signature"),
      },
      signingSecret: deps.signingSecret,
      nowMs: deps.now(),
    });

    if (!verified.ok) {
      return c.json({ error: verified.reason }, 401);
    }

    const params = new URLSearchParams(raw);
    const [subcommand = ""] = (params.get("text") ?? "").trim().split(/\s+/);

    switch (subcommand) {
      case "ping":
        return c.json(ephemeral("pong — deployed and listening."));

      case "slow":
        // Placeholder proving the deferral path: real subcommands that do work
        // (ingest, generate, export) hand it to `defer` and answer immediately.
        deps.defer(async () => {});
        return c.json(ephemeral("Working on it…"));

      default:
        return c.json(ephemeral(USAGE));
    }
  });

  return app;
}
