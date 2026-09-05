import { Hono } from "hono";
import type { DbStatus } from "../db/bootstrap.js";
import {
  buildUploadModal,
  GENERATE_ACTION_ID,
  ingestCatalog,
  UPLOAD_ACTION_ID,
  UPLOAD_BLOCK_ID,
  UPLOAD_CALLBACK_ID,
} from "../catalog/ingest.js";
import type { SqlClient } from "../db/client.js";
import {
  ensureReviewToken,
  getImageByObjectKey,
  setBatchState,
} from "../db/repository.js";
import type { ImageGenerator } from "../generation/generator.js";
import { describeWait } from "../generation/estimate.js";
import type { BrandContext } from "../generation/brand.js";
import type { PromptWriter } from "../generation/prompts.js";
import { startGeneration } from "../generation/start.js";
import type { ImageModel } from "../pricing.js";
import { buildStatusSummary } from "../status/status.js";
import { confirmBatch, CONFIRM_ACTION_ID } from "../decisions/confirm.js";
import { decide } from "../decisions/decide.js";
import { buildApprovedCatalog } from "../export/catalog.js";
import { buildLatestExport } from "../export/zip.js";
import {
  APPROVE_ACTION_ID,
  DISCARD_ACTION_ID,
} from "../generation/message.js";
import { renderReviewPage } from "../review/page.js";
import { buildReviewState } from "../review/state.js";
import type { ObjectStore } from "../storage/store.js";
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
  generator?: ImageGenerator;
  store?: ObjectStore;
  model?: ImageModel;
  aspectRatio?: string;
  /** Injected so the pipeline can be driven end to end without a network. */
  fetch?: typeof fetch;
  /** Absolute base for links handed to Slack. */
  publicBaseUrl?: string;
  /** Turns a shot idea into several distinct generation prompts. */
  promptWriterFor?: (brand: BrandContext) => PromptWriter;
}

const USAGE = [
  "Commands I know:",
  "• `/luma ping` — check I'm awake",
  "• `/luma upload` — drop in a catalog CSV",
  "• `/luma status` — where the latest batch stands",
  "• `/luma export` — download the approved photos of the latest confirmed batch",
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
          return c.json(
            ephemeral(
              await buildStatusSummary({
                db: deps.db,
                ...(deps.slack ? { slack: deps.slack } : {}),
                ...(deps.reviewChannelId ? { channel: deps.reviewChannelId } : {}),
                ...(deps.publicBaseUrl ? { publicBaseUrl: deps.publicBaseUrl } : {}),
              }),
            ),
          );
        } catch (error) {
          // Slack renders an unhandled error as a bare "dispatch_failed",
          // which tells a non-engineer nothing.
          console.error("[/luma status] failed", error);
          return c.json(
            ephemeral("I can't reach the database right now — try again shortly."),
          );
        }

      case "upload": {
        const { slack } = deps;
        const triggerId = params.get("trigger_id");
        if (!slack || !triggerId) {
          return c.json(ephemeral("Slack posting isn't configured on this instance."));
        }
        try {
          // Awaited, not deferred: `trigger_id` expires about three seconds
          // after the command, so the modal cannot wait behind other work.
          await slack.openView({ triggerId, view: buildUploadModal() });
          return c.body(null, 200);
        } catch (error) {
          console.error("[/luma upload] could not open modal", error);
          return c.json(ephemeral("I couldn't open the upload window — try again."));
        }
      }

      case "export": {
        const { slack, store, reviewChannelId } = deps;
        if (!slack || !store || !reviewChannelId) {
          return c.json(ephemeral("Export isn't configured on this instance."));
        }
        // Fetching every approved image and zipping it is far too slow for the
        // acknowledgement window.
        deps.defer(async () => {
          try {
            const result = await buildLatestExport(deps.db, store);
            if (!result.ok) {
              await slack.postMessage({ channel: reviewChannelId, text: result.reason });
              return;
            }
            await slack.uploadFile({
            channel: reviewChannelId,
            filename: result.filename,
            title: result.filename,
            bytes: result.bytes,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text:
                    `*Batch #${result.batchId} — ${result.count} approved ` +
                    `${result.count === 1 ? "photo" : "photos"}.*\nEvery file is named ` +
                    "for its product and shot idea. MANIFEST.txt lists them with " +
                      "their checksums.",
                  },
                },
              ],
            });
          } catch (error) {
            // Silence here leaves the reviewer waiting for a zip that is never
            // coming, with nothing to act on.
            console.error("[/luma export] failed", error);
            await slack.postMessage({
              channel: reviewChannelId,
              text:
                "I couldn't build the export just now — the photos are all still " +
                "stored, so try `/luma export` again in a moment.",
            });
          }
        });
        return c.json(ephemeral("Putting the zip together…"));
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

  /**
   * Serves a stored image.
   *
   * The object key is random so the URL is unguessable, while the meaningful
   * name is attached here as a content disposition — the two properties are
   * different fields rather than a compromise between them.
   */
  app.get("/img/:id", async (c) => {
    if (!deps.store) return c.text("storage not configured", 503);

    const id = c.req.param("id").replace(/\.jpg$/, "");
    const objectKey = `images/${id}.jpg`;

    const image = await getImageByObjectKey(deps.db, objectKey);
    if (!image) return c.text("not found", 404);

    try {
      const object = await deps.store.get(objectKey);
      return c.body(new Uint8Array(object.bytes), 200, {
        "content-type": object.contentType,
        "content-disposition": `inline; filename="${image.filename}"`,
        "cache-control": "public, max-age=31536000, immutable",
      });
    } catch {
      return c.text("not found", 404);
    }
  });

  /** The read-only overview. Unguessable token, no login, no actions. */
  app.get("/review/:token", async (c) => {
    const token = c.req.param("token");
    const state = await buildReviewState(deps.db, token);
    if (!state) return c.text("Not found", 404);
    return c.html(renderReviewPage(state, token));
  });

  /** What the page polls. Same state, as JSON. */
  app.get("/api/review/:token", async (c) => {
    const state = await buildReviewState(deps.db, c.req.param("token"));
    if (!state) return c.json({ error: "not_found" }, 404);
    return c.json(state, 200, { "cache-control": "no-store" });
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

    if (payload.type === "view_submission") {
      if (payload.view?.callback_id !== UPLOAD_CALLBACK_ID) return c.body(null, 200);

      const file =
        payload.view?.state?.values?.[UPLOAD_BLOCK_ID]?.[UPLOAD_ACTION_ID]
          ?.files?.[0];
      const { slack, reviewChannelId } = deps;

      if (file?.url_private && slack && reviewChannelId) {
        const channel = reviewChannelId;
        const url = file.url_private;
        const name = file.name ?? "catalog.csv";
        // Downloading and parsing is far too slow for the acknowledgement
        // window; an empty 200 closes the modal immediately.
        deps.defer(async () => {
          await ingestCatalog({
            slack,
            db: deps.db,
            channel,
            fileUrl: url,
            filename: name,
          });
        });
      }

      return c.body(null, 200);
    }

    if (payload.type !== "block_actions") return c.body(null, 200);

    const action = payload.actions?.[0];
    const channel = payload.channel?.id;
    const ts = payload.message?.ts;
    const userId = payload.user?.id;

    if (action?.action_id === CONFIRM_ACTION_ID && deps.slack && deps.reviewChannelId) {
      const { slack, reviewChannelId, approverUserId } = deps;
      const batchId = Number(action.value);
      const responseUrl = payload.response_url;

      deps.defer(async () => {
        // Fail closed: two missing values must not compare equal and let an
        // unidentified click through the only authorisation in this path.
        const outcome =
          userId && approverUserId
            ? await confirmBatch({
                db: deps.db,
                batchId,
                actorUserId: userId,
                approverUserId,
              })
            : ({ ok: false, reason: "I can't tell who you are." } as const);

        if (!outcome.ok) {
          if (responseUrl) await slack.respondEphemeral(responseUrl, outcome.reason);
          return;
        }

        await slack.postMessage({
          channel: reviewChannelId,
          text:
            `*Batch #${outcome.batchId} is confirmed.* ${outcome.approved} ` +
            `${outcome.approved === 1 ? "photo is" : "photos are"} ready to publish — ` +
            "run `/luma export` to download them.",
        });

        // The one artefact that writes back to the spreadsheet the team lives
        // in: which requests are actually done.
        if (deps.publicBaseUrl) {
          const csv = await buildApprovedCatalog(
            deps.db,
            outcome.batchId,
            deps.publicBaseUrl,
          );
          await slack.uploadFile({
            channel: reviewChannelId,
            filename: csv.filename,
            title: csv.filename,
            bytes: Buffer.from(csv.content, "utf8"),
          });
        }
      });

      return c.body(null, 200);
    }

    const isDecision =
      action?.action_id === APPROVE_ACTION_ID ||
      action?.action_id === DISCARD_ACTION_ID;

    if (isDecision && deps.slack && deps.reviewChannelId && action.value) {
      const { slack, reviewChannelId, approverUserId } = deps;
      const imageId = action.value;
      const decision =
        action.action_id === APPROVE_ACTION_ID ? "approve" : "discard";
      const responseUrl = payload.response_url;

      // Recording and redrawing both take longer than the acknowledgement
      // window allows, so the click is answered first and the work follows.
      deps.defer(async () => {
        // Fail closed, as above.
        const outcome =
          userId && approverUserId
            ? await decide({
                db: deps.db,
                slack,
                channel: reviewChannelId,
                imageId,
                decision,
                actorUserId: userId,
                approverUserId,
                log: (message) => console.log(message),
              })
            : ({ ok: false, reason: "I can't tell who you are." } as const);

        // A refusal is told only to the person who clicked. Announcing it to
        // the channel would be a public correction of a private mistake.
        if (!outcome.ok && responseUrl) {
          await slack.respondEphemeral(responseUrl, outcome.reason);
        }
      });

      return c.body(null, 200);
    }

    if (action?.action_id === GENERATE_ACTION_ID && deps.slack && channel) {
      const { slack, generator, store, reviewChannelId } = deps;
      const batchId = Number(action.value);

      if (!generator || !store || !reviewChannelId) {
        deps.defer(async () => {
          await slack.postMessage({
            channel,
            text: "Generation isn't configured on this instance.",
            ...(ts ? { threadTs: ts } : {}),
          });
        });
        return c.body(null, 200);
      }

      // Announce first, work second. Turning sixteen shot ideas into prompts
      // is a minute or more of API calls, and doing it before saying anything
      // leaves the channel silent — indistinguishable from a broken button.
      deps.defer(async () => {
        const reviewToken = await ensureReviewToken(deps.db, batchId);
        const overviewUrl = deps.publicBaseUrl
          ? `${deps.publicBaseUrl}/review/${reviewToken}`
          : null;

        try {
          await slack.postMessage({
            channel,
            text: [
              `*Batch #${batchId} has started.*`,
              "",
              "I'm writing the prompts now, then generating. *Nothing will " +
                "appear straight away* — photos are posted once a product's " +
                "whole set has finished, so they arrive product by product.",
              "",
              "You don't need to wait here — I'll mention you once the whole " +
                "batch is ready to review.",
              ...(overviewUrl
                ? ["", `*Overview page:* ${overviewUrl}`]
                : []),
            ].join("\n"),
          });

          const counts = await startGeneration(deps.db, batchId, {
            ...(deps.promptWriterFor ? { promptWriterFor: deps.promptWriterFor } : {}),
            log: (message) => console.log(message),
          });
          await setBatchState(deps.db, batchId, "generating");

          const total = counts.styled + counts.passThrough;
          await slack.postMessage({
            channel,
            text:
              `Generating *${counts.styled}* styled photos and copying ` +
              `*${counts.passThrough}* originals across — *${total}* to review ` +
              `in all. This usually takes ${describeWait(total)}.`,
          });
        } catch (error) {
          // Without this the failure reaches stderr and nobody is told, which
          // looks exactly like a button that does nothing.
          console.error("[generate] failed", error);
          await slack
            .postMessage({
              channel,
              text:
                `I couldn't start batch #${batchId}: ${(error as Error).message}\n` +
                "Nothing has been charged. Press Generate again, or re-upload " +
                "the file if it keeps failing.",
            })
            .catch(() => {});
        }
      });

      return c.body(null, 200);
    }

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

interface SlackFile {
  id?: string;
  name?: string;
  url_private?: string;
}

interface BlockActionsPayload {
  type?: string;
  response_url?: string;
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
  view?: {
    callback_id?: string;
    state?: {
      values?: Record<string, Record<string, { files?: SlackFile[] }>>;
    };
  };
}
