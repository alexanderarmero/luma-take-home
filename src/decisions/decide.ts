import type { SqlClient } from "../db/client.js";
import {
  getBatchState,
  getImageLocation,
  getProductImages,
  isBatchFrozen,
  recordDecision,
  type Decision,
} from "../db/repository.js";
import {
  buildCandidateBlocks,
  buildProductChannelMessage,
} from "../generation/message.js";
import type { SlackClient } from "../slack/client.js";
import { offerConfirmationIfComplete } from "./confirm.js";

export type DecisionOutcome =
  | { ok: true; decision: Decision; filename: string }
  | { ok: false; reason: string };

export interface DecideInput {
  db: SqlClient;
  slack: SlackClient;
  channel: string;
  imageId: string;
  decision: Decision;
  actorUserId: string;
  approverUserId: string;
  /** Included in the product's line so Slack links back to the page. */
  reviewUrl?: string;
  log?: (message: string) => void;
}

/**
 * Records a decision, then reflects it back into Slack.
 *
 * The order is deliberate. The decision is committed first and the Slack
 * updates are cosmetic — a failure to redraw a message must never be able to
 * lose the decision it was describing.
 */
export async function decide(input: DecideInput): Promise<DecisionOutcome> {
  const { db, slack, channel, imageId, decision, actorUserId, approverUserId } = input;
  const log = input.log ?? (() => {});

  // Enforced against the user the platform reports, never against anything the
  // client sent — the whole reason identity is worth having for free.
  if (actorUserId !== approverUserId) {
    return {
      ok: false,
      reason:
        "Only Ellie can approve or discard. You can still say what you think " +
        "in this thread — that's what it's for.",
    };
  }

  const location = await getImageLocation(db, imageId);
  if (!location) return { ok: false, reason: "I can't find that image any more." };

  if (await isBatchFrozen(db, location.batchId)) {
    return {
      ok: false,
      reason:
        `Batch #${location.batchId} has already been confirmed, so it can't be ` +
        "changed. If something needs fixing, run those products again as a new batch.",
    };
  }

  await recordDecision(db, { imageId, decision, actor: actorUserId });

  // Everything past this point is redrawing. Each is attempted separately so a
  // failure in one does not prevent the other.
  const product = await getProductImages(db, location.batchId, location.sku);

  if (location.productMessageTs) {
    const refreshed = buildProductChannelMessage({
      sku: location.sku,
      productName: product.productName,
      shotIdea: product.shotIdea,
      images: product.images,
      ...(input.reviewUrl ? { reviewUrl: `${input.reviewUrl}#p-${location.sku}` } : {}),
    });
    try {
      await slack.updateMessage({
        channel,
        ts: location.productMessageTs,
        text: refreshed.text,
        blocks: refreshed.blocks,
      });
    } catch (error) {
      log(`[decide] could not refresh the product line: ${(error as Error).message}`);
    }
  }

  if (location.messageTs) {
    const image = product.images.find((i) => i.imageId === imageId);
    try {
      await slack.updateMessage({
        channel,
        ts: location.messageTs,
        text: location.filename,
        blocks: image ? buildCandidateBlocks(image) : [],
      });
    } catch (error) {
      log(`[decide] could not redraw the candidate: ${(error as Error).message}`);
    }
  }

  // The moment nothing is left undecided, offer the handover. Checking here
  // rather than on a timer means the control appears immediately after the
  // decision that completed the batch.
  try {
    await offerConfirmationIfComplete({
      db,
      slack,
      channel,
      batchId: location.batchId,
      batchState: await getBatchState(db, location.batchId),
      approverUserId,
      ...(input.reviewUrl ? { reviewUrl: input.reviewUrl } : {}),
    });
  } catch (error) {
    log(`[decide] could not offer confirmation: ${(error as Error).message}`);
  }

  return { ok: true, decision, filename: location.filename };
}
