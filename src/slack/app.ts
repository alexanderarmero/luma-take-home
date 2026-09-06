import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { DbStatus } from "../db/bootstrap.js";
import {
  buildCheckingModal,
  buildIngestErrorModal,
  buildUploadModal,
  ingestCatalog,
  RECAP_CALLBACK_ID,
  UPLOAD_ACTION_ID,
  UPLOAD_BLOCK_ID,
  UPLOAD_CALLBACK_ID,
} from "../catalog/ingest.js";
import type { SqlClient } from "../db/client.js";
import {
  getImageByObjectKey,
  getIntroMessageTs,
  retryFailedImage,
} from "../db/repository.js";
import { startBatchAndAnnounce } from "../generation/announce.js";
import { runOneOff } from "../generation/oneoff.js";
import {
  buildOneOffModal,
  ONEOFF_CALLBACK_ID,
  ONEOFF_FILE_ACTION,
  ONEOFF_FILE_BLOCK,
  ONEOFF_PROMPT_ACTION,
  ONEOFF_PROMPT_BLOCK,
} from "../generation/oneoff-modal.js";
import { regenerate } from "../generation/regenerate.js";
import type { ImageGenerator } from "../generation/generator.js";
import type { BrandContext } from "../generation/brand.js";
import type { PromptWriter } from "../generation/prompts.js";
import type { ImageModel } from "../pricing.js";
import {
  buildPromptModal,
  PROMPT_ACTION_ID,
  PROMPT_BLOCK_ID,
  PROMPT_CALLBACK_ID,
} from "../settings/modal.js";
import { savePromptDirection } from "../settings/prompt.js";
import { buildStatusSummary } from "../status/status.js";
import {
  ACCESS_ADD_ACTION,
  ACCESS_ADD_BLOCK,
  ACCESS_CALLBACK_ID,
  ACCESS_REVOKE_ACTION,
  applyAccessChanges,
  buildAccessModal,
  revokeIfPermitted,
} from "../access/commands.js";
import { buildHelp } from "../access/help.js";
import {
  canAdminister,
  canWrite,
  createMagicLink,
  findSession,
  redeemMagicLink,
} from "../access/store.js";
import { confirmBatch } from "../decisions/confirm.js";
import { decide } from "../decisions/decide.js";
import { buildApprovedCatalog } from "../export/catalog.js";
import { buildLatestExport } from "../export/zip.js";
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
  promptWriterFor?: (brand: BrandContext, direction: string) => PromptWriter;
  /**
   * Names a modal we push but never learn the id of.
   *
   * Injected so a test can predict it; in production it is random, because
   * external ids are workspace-wide and two uploads must not collide.
   */
  newExternalId?: () => string;
}

/**
 * External ids are unique per workspace, so two uploads in flight at once
 * must not name the same view.
 */
function defaultExternalId(): string {
  return `luma-${randomUUID()}`;
}

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
    const userId = params.get("user_id") ?? "";

    // Two ways in, one handler. `/luma upload` carries the verb in the text;
    // `/luma-upload` carries it in the command name, which is what makes each
    // verb separately autocompletable in Slack's typeahead. The dedicated
    // command wins when both could apply, because naming the command is the
    // more specific statement of intent.
    const named = (params.get("command") ?? "").replace(/^\/luma-?/, "");
    const [typed = ""] = (params.get("text") ?? "").trim().split(/\s+/);
    const subcommand = named || typed;

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

      case "help":
        return c.json(
          ephemeral(
            buildHelp(canAdminister(userId, deps.approverUserId ?? "")),
          ),
        );

      case "signin": {
        if (!deps.publicBaseUrl) {
          return c.json(ephemeral("Sign-in isn't configured on this instance."));
        }
        // Answered privately to whoever typed it. Slack already knows who that
        // is, which is the whole reason this needs no email provider.
        const token = await createMagicLink(deps.db, userId, deps.now());
        return c.json(
          ephemeral(
            `*Your sign-in link* — ${deps.publicBaseUrl}/auth/${token}\n` +
              "_Good for ten minutes and one use. Signing in lasts a day._",
          ),
        );
      }

      case "access": {
        const { slack } = deps;
        const triggerId = params.get("trigger_id");
        if (!slack || !triggerId) {
          return c.json(ephemeral("Access management isn't configured here."));
        }
        if (!canAdminister(userId, deps.approverUserId ?? "")) {
          return c.json(
            ephemeral("Only the configured approver can change who has access."),
          );
        }
        await slack.openView({
          triggerId,
          view: await buildAccessModal(deps.db, deps.approverUserId ?? ""),
        });
        return c.body(null, 200);
      }

      case "generate": {
        const { slack } = deps;
        const triggerId = params.get("trigger_id");
        if (!slack || !triggerId || !deps.generator || !deps.store) {
          return c.json(ephemeral("One-off shots aren't configured here."));
        }
        if (!deps.publicBaseUrl) {
          return c.json(
            ephemeral(
              "I don't know my own public address, so Luma can't fetch the " +
                "photo you upload. Set PUBLIC_BASE_URL.",
            ),
          );
        }
        // Same list as approving: this spends money, even if only a dime.
        if (!(await canWrite(deps.db, userId, deps.approverUserId ?? ""))) {
          return c.json(
            ephemeral(
              "Only people who can approve photos can generate them. Ask the " +
                "approver to add you with `/luma access`.",
            ),
          );
        }
        await slack.openView({ triggerId, view: buildOneOffModal() });
        return c.body(null, 200);
      }

      case "system-prompt": {
        const { slack } = deps;
        const triggerId = params.get("trigger_id");
        if (!slack || !triggerId) {
          return c.json(ephemeral("That isn't available on this instance."));
        }
        // Same list as the page: this changes what gets made and what it
        // costs, so it belongs with the people who can approve the results.
        if (!(await canWrite(deps.db, userId, deps.approverUserId ?? ""))) {
          return c.json(
            ephemeral(
              "Only people who can approve photos can change the system " +
                "prompt. Ask the approver to add you with `/luma access`.",
            ),
          );
        }
        await slack.openView({
          triggerId,
          view: await buildPromptModal(deps.db),
        });
        return c.body(null, 200);
      }

      default:
        return c.json(
          ephemeral(buildHelp(canAdminister(userId, deps.approverUserId ?? ""))),
        );
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

  /**
   * A one-off source photograph, for Luma to fetch.
   *
   * Deliberately a separate namespace from `/img`: that route serves a
   * batch's images and checks the database for one, this route serves scratch
   * uploads and never touches it. Neither can reach the other's objects.
   */
  app.get("/src/:id", async (c) => {
    if (!deps.store) return c.text("storage not configured", 503);

    const id = c.req.param("id").replace(/\.jpg$/, "");
    // The id is a random UUID minted by the store, and it is the only thing
    // guarding the object — so it must not be built from anything a caller
    // supplied.
    if (!/^[0-9a-f-]{36}$/i.test(id)) return c.text("not found", 404);

    try {
      const object = await deps.store.get(`scratch/${id}.jpg`);
      return c.body(new Uint8Array(object.bytes), 200, {
        "content-type": object.contentType,
        "cache-control": "public, max-age=3600",
      });
    } catch {
      return c.text("not found", 404);
    }
  });

  /**
   * Trades a magic link for a session.
   *
   * The cookie carries the right to act; the batch token in a review URL
   * carries the right to see. Keeping them apart is what makes forwarding a
   * link share reading and never writing.
   */
  app.get("/auth/:token", async (c) => {
    const session = await redeemMagicLink(deps.db, c.req.param("token"), deps.now());
    if (!session) {
      return c.html(
        signInResult("That link has expired or been used already. Run `/luma signin` in Slack for a fresh one."),
        400,
      );
    }

    c.header(
      "set-cookie",
      `luma_session=${session.id}; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`,
    );
    return c.html(
      signInResult("You're signed in for the next day. Open the batch link from Slack to review."),
    );
  });

  /**
   * Who, if anyone, this request may act as.
   *
   * The session answers "who are you"; the access list answers "may you act",
   * and it is consulted on every request rather than cached at sign-in — so
   * revoking someone takes effect at once rather than in a day.
   */
  const resolveWriter = async (
    c: { req: { raw: Request } },
  ): Promise<string | null> => {
    const sessionId = getCookie(c as never, "luma_session");
    if (!sessionId) return null;

    const session = await findSession(deps.db, sessionId, deps.now());
    if (!session) return null;

    const allowed = await canWrite(
      deps.db,
      session.slackUserId,
      deps.approverUserId ?? "",
    );
    return allowed ? session.slackUserId : null;
  };

  /**
   * The overview. Read-only unless the request carries a session belonging to
   * someone with write access.
   */
  app.get("/review/:token", async (c) => {
    const token = c.req.param("token");
    const state = await buildReviewState(deps.db, token);
    if (!state) return c.text("Not found", 404);

    const writer = await resolveWriter(c);
    return c.html(renderReviewPage(state, token, { canWrite: writer !== null }));
  });

  /** What the page polls. Same state, as JSON. */
  app.get("/api/review/:token", async (c) => {
    const state = await buildReviewState(deps.db, c.req.param("token"));
    if (!state) return c.json({ error: "not_found" }, 404);
    return c.json(state, 200, { "cache-control": "no-store" });
  });

  /** Approve or discard one photo. */
  app.post("/api/review/:token/decide", async (c) => {
    const state = await buildReviewState(deps.db, c.req.param("token"));
    if (!state) return c.json({ error: "not_found" }, 404);

    const writer = await resolveWriter(c);
    if (!writer) return c.json({ error: "not_allowed" }, 403);
    if (!deps.slack || !deps.reviewChannelId) {
      return c.json({ error: "not_configured" }, 503);
    }

    const body = (await c.req.json().catch(() => null)) as {
      imageId?: string;
      decision?: "approve" | "discard";
    } | null;

    if (!body?.imageId || (body.decision !== "approve" && body.decision !== "discard")) {
      return c.json({ error: "bad_request" }, 400);
    }

    const outcome = await decide({
      db: deps.db,
      slack: deps.slack,
      channel: deps.reviewChannelId,
      imageId: body.imageId,
      decision: body.decision,
      actorUserId: writer,
      // Already authorised above, against the list rather than one identity.
      approverUserId: writer,
      ...(deps.publicBaseUrl ? { reviewUrl: `${deps.publicBaseUrl}/review/${c.req.param("token")}` } : {}),
      log: (message) => console.log(message),
    });

    return outcome.ok
      ? c.json({ ok: true })
      : c.json({ error: "refused", reason: outcome.reason }, 409);
  });

  /** Ask for one more shot of a product, from a prompt somebody wrote. */
  app.post("/api/review/:token/regenerate", async (c) => {
    const state = await buildReviewState(deps.db, c.req.param("token"));
    if (!state) return c.json({ error: "not_found" }, 404);

    const writer = await resolveWriter(c);
    if (!writer) return c.json({ error: "not_allowed" }, 403);

    const body = (await c.req.json().catch(() => null)) as {
      imageId?: string;
      prompt?: string;
    } | null;
    if (!body?.imageId || typeof body.prompt !== "string") {
      return c.json({ error: "bad_request" }, 400);
    }

    const outcome = await regenerate({
      db: deps.db,
      imageId: body.imageId,
      prompt: body.prompt,
    });

    if (!outcome.ok) {
      return c.json({ error: "refused", reason: outcome.reason }, 409);
    }
    return c.json({ ok: true, imageId: outcome.imageId });
  });

  /** Put a photo that never arrived back in the queue. */
  app.post("/api/review/:token/retry", async (c) => {
    const state = await buildReviewState(deps.db, c.req.param("token"));
    if (!state) return c.json({ error: "not_found" }, 404);

    const writer = await resolveWriter(c);
    if (!writer) return c.json({ error: "not_allowed" }, 403);

    const body = (await c.req.json().catch(() => null)) as { imageId?: string } | null;
    if (!body?.imageId) return c.json({ error: "bad_request" }, 400);

    const outcome = await retryFailedImage(deps.db, body.imageId);
    return outcome.ok
      ? c.json({ ok: true })
      : c.json({ error: "refused", reason: outcome.reason }, 409);
  });

  /** Freeze the batch and hand it over. */
  app.post("/api/review/:token/confirm", async (c) => {
    const state = await buildReviewState(deps.db, c.req.param("token"));
    if (!state) return c.json({ error: "not_found" }, 404);

    const writer = await resolveWriter(c);
    if (!writer) return c.json({ error: "not_allowed" }, 403);

    const outcome = await confirmBatch({ db: deps.db, batchId: state.batchId });
    if (!outcome.ok) {
      return c.json({ error: "refused", reason: outcome.reason }, 409);
    }

    if (deps.slack && deps.reviewChannelId) {
      const { slack, reviewChannelId } = deps;
      deps.defer(async () => {
        // The batch is finished, so its opening message stops being the thing
        // people need to hand. Leaving it pinned would mean the channel's
        // pins slowly become a list of everything that ever happened.
        const introTs = await getIntroMessageTs(deps.db, outcome.batchId);
        if (introTs) {
          await slack
            .unpinMessage({ channel: reviewChannelId, ts: introTs })
            .catch(() => {});
        }

        await slack.postMessage({
          channel: reviewChannelId,
          text:
            `*Batch #${outcome.batchId} is confirmed* by <@${writer}>. ` +
            `${outcome.approved} ${outcome.approved === 1 ? "photo is" : "photos are"} ` +
            "ready to publish — run `/luma export` to download them.",
        });
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
    }

    return c.json({ ok: true });
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

    const userId = payload.user?.id;

    if (payload.type === "view_submission") {
      if (payload.view?.callback_id === ACCESS_CALLBACK_ID) {
        const added =
          payload.view?.state?.values?.[ACCESS_ADD_BLOCK]?.[ACCESS_ADD_ACTION]
            ?.selected_users ?? [];
        deps.defer(async () => {
          await applyAccessChanges(deps.db, {
            actorUserId: userId ?? "",
            approverUserId: deps.approverUserId ?? "",
            addUserIds: added,
          });
        });
        return c.body(null, 200);
      }

      if (payload.view?.callback_id === ONEOFF_CALLBACK_ID) {
        const values = payload.view?.state?.values;
        const file = values?.[ONEOFF_FILE_BLOCK]?.[ONEOFF_FILE_ACTION]?.files?.[0];
        const prompt =
          values?.[ONEOFF_PROMPT_BLOCK]?.[ONEOFF_PROMPT_ACTION]?.value ?? "";

        const { slack, generator, store, publicBaseUrl } = deps;
        if (!slack || !generator || !store || !publicBaseUrl) {
          return c.body(null, 200);
        }

        // Re-checked here rather than trusted from the modal being open: the
        // view outlives the permission that opened it.
        if (!(await canWrite(deps.db, userId ?? "", deps.approverUserId ?? ""))) {
          return c.json({
            response_action: "errors",
            errors: {
              [ONEOFF_PROMPT_BLOCK]: "You no longer have access to generate photos.",
            },
          });
        }
        if (!file?.url_private) {
          return c.json({
            response_action: "errors",
            errors: { [ONEOFF_FILE_BLOCK]: "I couldn't read that file." },
          });
        }

        const url = file.url_private;
        const name = file.name ?? "photo.jpg";
        const asker = userId ?? "";

        // Generation outlasts the modal by a long way, so the answer goes to
        // a conversation rather than to this view.
        deps.defer(async () => {
          await runOneOff({
            slack,
            store,
            generator,
            userId: asker,
            fileUrl: url,
            filename: name,
            prompt,
            model: deps.model ?? "uni-1-max",
            aspectRatio: deps.aspectRatio ?? "1:1",
            publicBaseUrl,
            ...(deps.fetch ? { fetch: deps.fetch } : {}),
            log: (message) => console.log(message),
          });
        });

        return c.body(null, 200);
      }

      if (payload.view?.callback_id === PROMPT_CALLBACK_ID) {
        const text =
          payload.view?.state?.values?.[PROMPT_BLOCK_ID]?.[PROMPT_ACTION_ID]
            ?.value ?? "";

        // Re-checked here rather than trusted from the modal being open: the
        // view outlives the permission that opened it.
        if (!(await canWrite(deps.db, userId ?? "", deps.approverUserId ?? ""))) {
          return c.json({
            response_action: "errors",
            errors: {
              [PROMPT_BLOCK_ID]:
                "You no longer have access to change the system prompt.",
            },
          });
        }

        const outcome = await savePromptDirection(deps.db, {
          text,
          byUserId: userId ?? "",
        });

        if (!outcome.ok) {
          return c.json({
            response_action: "errors",
            errors: { [PROMPT_BLOCK_ID]: outcome.reason },
          });
        }

        const { slack, reviewChannelId } = deps;
        if (slack && reviewChannelId) {
          const said = outcome.reverted
            ? "reverted the system prompt to the built-in wording"
            : "changed the system prompt";
          // Said in the channel because it changes what every future batch
          // looks like, and a silent change is one nobody can attribute.
          deps.defer(async () => {
            await slack.postMessage({
              channel: reviewChannelId,
              text:
                `<@${userId}> ${said}. It applies to the *next* batch — ` +
                "photos already generated are never re-made. Run " +
                "`/luma system-prompt` to see it.",
            });
          });
        }

        return c.body(null, 200);
      }

      if (payload.view?.callback_id === RECAP_CALLBACK_ID) {
        const batchId = Number(payload.view?.private_metadata);
        const { slack, generator, store, reviewChannelId } = deps;

        // A view with no input blocks has nowhere to hang a field error, so a
        // refusal replaces the view — said where the person is looking rather
        // than in a channel they may not have open, or worse, nowhere at all.
        const cannotRun =
          !slack || !reviewChannelId
            ? "I'm not configured to post to a review channel, so there is " +
              "nowhere to put the photos. Nothing has been charged."
            : !generator || !store
              ? "Generation isn't configured on this instance, so there is " +
                "nothing to run. Nothing has been charged."
              : null;

        if (cannotRun || !slack || !reviewChannelId || !generator || !store) {
          return c.json({
            response_action: "update",
            view: buildIngestErrorModal(`err-${batchId}`, cannotRun ?? ""),
          });
        }

        deps.defer(async () => {
          await startBatchAndAnnounce({
            db: deps.db,
            slack,
            channel: reviewChannelId,
            batchId,
            ...(deps.publicBaseUrl ? { publicBaseUrl: deps.publicBaseUrl } : {}),
            ...(deps.promptWriterFor ? { promptWriterFor: deps.promptWriterFor } : {}),
            ...(deps.model ? { model: deps.model } : {}),
          });
        });

        // "clear", not an empty body. An empty 200 closes only the view being
        // submitted, and this one was *pushed* on top of the upload view — so
        // closing it drops the person back onto the upload form they already
        // finished with, which reads exactly like the button did nothing.
        return c.json({ response_action: "clear" });
      }

      if (payload.view?.callback_id !== UPLOAD_CALLBACK_ID) return c.body(null, 200);

      const file =
        payload.view?.state?.values?.[UPLOAD_BLOCK_ID]?.[UPLOAD_ACTION_ID]
          ?.files?.[0];
      const { slack } = deps;

      if (!file?.url_private || !slack) return c.body(null, 200);

      const url = file.url_private;
      const name = file.name ?? "catalog.csv";
      // Reading and parsing the file is far too slow for the three-second
      // submission window, so the response pushes a view saying so and the
      // work draws its own outcome into that view when it finishes.
      const externalId = (deps.newExternalId ?? defaultExternalId)();

      deps.defer(async () => {
        await ingestCatalog({
          slack,
          db: deps.db,
          externalId,
          fileUrl: url,
          filename: name,
        });
      });

      return c.json({
        response_action: "push",
        view: buildCheckingModal(externalId),
      });
    }

    if (payload.type !== "block_actions") return c.body(null, 200);

    const action = payload.actions?.[0];
    const channel = payload.channel?.id;
    const ts = payload.message?.ts;

    if (action?.action_id?.startsWith(`${ACCESS_REVOKE_ACTION}:`) && deps.slack) {
      const { slack } = deps;
      const target = action.value ?? "";
      const viewId = payload.view?.id;
      const responseUrl = payload.response_url;

      deps.defer(async () => {
        const outcome = await revokeIfPermitted(deps.db, {
          actorUserId: userId ?? "",
          approverUserId: deps.approverUserId ?? "",
          targetUserId: target,
        });

        if (!outcome.ok) {
          if (responseUrl) await slack.respondEphemeral(responseUrl, outcome.reason!);
          return;
        }
        // Redraw the modal so the row disappears rather than lingering.
        if (viewId) {
          await slack.updateView({
            viewId,
            view: await buildAccessModal(deps.db, deps.approverUserId ?? ""),
          });
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

/** Deliberately plain: it is a waypoint, not a destination. */
function signInResult(message: string): string {
  return `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Luma</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;
       font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
       padding:24px;text-align:center}
  p{max-width:32ch}
</style>
<p>${message}</p>`;
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
    id?: string;
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<
        string,
        Record<
          string,
          { files?: SlackFile[]; selected_users?: string[]; value?: string | null }
        >
      >;
    };
  };
}
