import { Hono } from "hono";
import type { DbStatus } from "../db/bootstrap.js";
import type { SqlClient } from "../db/client.js";
import { buildStatusSummary } from "../status/status.js";
import type { SlackClient } from "./client.js";
import { verifySlackSignature } from "./signature.js";
import {
  runVerificationProbes,
  summariseReport,
  VERIFY_ACTION_ID,
} from "./verify.js";

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
  slack?: SlackClient;
  reviewChannelId?: string;
  approverUserId?: string;
}

const USAGE = [
  "Commands I know:",
  "• `/luma ping` — check I'm awake",
  "• `/luma status` — where the latest batch stands",
  "• `/luma verify` — post the platform-verification probes",
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

      case "verify": {
        const { slack, reviewChannelId, approverUserId } = deps;
        if (!slack || !reviewChannelId || !approverUserId) {
          return c.json(ephemeral("Slack posting isn't configured on this instance."));
        }
        // Posting three probes, one of which downloads a photo, is far too
        // slow for the acknowledgement window.
        deps.defer(async () => {
          const report = await runVerificationProbes(slack, {
            channel: reviewChannelId,
            approverUserId,
          });
          await slack.postMessage({
            channel: reviewChannelId,
            text: summariseReport(report),
          });
        });
        return c.json(ephemeral("Posting three probes to the review channel…"));
      }

      default:
        return c.json(ephemeral(USAGE));
    }
  });

  app.post("/slack/interactions", async (c) => {
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

    if (!verified.ok) return c.json({ error: verified.reason }, 401);

    // Everything below answers 200 no matter what. A non-2xx here shows the
    // person who clicked a red failure banner in Slack, which tells them
    // nothing and cannot be retried usefully.
    let payload: BlockActionsPayload;
    try {
      payload = JSON.parse(
        new URLSearchParams(raw).get("payload") ?? "{}",
      ) as BlockActionsPayload;
    } catch {
      console.error("[interactions] unparseable payload");
      return c.body(null, 200);
    }

    if (payload.type !== "block_actions") return c.body(null, 200);

    const action = payload.actions?.[0];
    const channel = payload.channel?.id;
    const ts = payload.message?.ts;
    const userId = payload.user?.id;

    if (action?.action_id === VERIFY_ACTION_ID && deps.slack && channel && ts) {
      const slack = deps.slack;
      deps.defer(async () => {
        await slack.updateMessage({
          channel,
          ts,
          text:
            `✅ *It works.* Interactive buttons are delivered and actionable here — ` +
            `tapped by <@${userId}>.`,
        });
      });
    }

    return c.body(null, 200);
  });

  return app;
}

interface BlockActionsPayload {
  type?: string;
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
}
