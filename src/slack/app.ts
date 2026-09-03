import { Hono } from "hono";
import type { DbStatus } from "../db/bootstrap.js";
import type { SqlClient } from "../db/client.js";
import { buildStatusSummary } from "../status/status.js";
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
  db: SqlClient;
  /** Reported by /healthz so a database problem is diagnosable with curl. */
  dbStatus?: () => DbStatus;
}

const USAGE = [
  "Commands I know:",
  "• `/luma ping` — check I'm awake",
  "• `/luma status` — where the latest batch stands",
].join("\n");

/** Slack renders this only to the person who typed the command. */
function ephemeral(text: string) {
  return { response_type: "ephemeral" as const, text };
}

export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get("/healthz", (c) => {
    const db = deps.dbStatus?.() ?? { state: "ready" as const, attempts: 0 };
    return c.json({
      status: db.state === "ready" ? "ok" : "degraded",
      db: db.state,
      dbAttempts: db.attempts,
      ...(db.detail ? { dbDetail: db.detail } : {}),
    });
  });

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

      case "status":
        try {
          return c.json(ephemeral(await buildStatusSummary(deps.db)));
        } catch (error) {
          // Slack renders an unhandled error as a bare "dispatch_failed",
          // which tells a non-engineer nothing.
          console.error("[/luma status] failed", error);
          return c.json(
            ephemeral("I can't reach the database right now — try again shortly."),
          );
        }

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
