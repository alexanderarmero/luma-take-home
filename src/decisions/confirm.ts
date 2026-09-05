import type { SqlClient } from "../db/client.js";
import {
  batchDecisionCounts,
  getBatchState,
  setBatchState,
  setDeliveredBatch,
  transitionBatchState,
} from "../db/repository.js";
import type { Block, SlackClient } from "../slack/client.js";

/**
 * Posted the moment a batch is fully decided.
 *
 * A new message rather than an edit to the one that opened the batch: after
 * scrolling a channel of products, the reviewer is at the bottom, and a button
 * they passed an hour ago is one they will not go back for. It also cannot be
 * pressed early, because it does not exist until it applies.
 */
/**
 * The nudge, not the control.
 *
 * Confirming freezes a batch and hands it over, so it belongs where the whole
 * set is visible at once rather than behind a button in a channel.
 */
function confirmBlocks(
  batchId: number,
  counts: { approved: number; discarded: number },
  reviewUrl?: string,
): Block[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Batch #${batchId} — everything has been decided.*\n` +
          `*${counts.approved}* approved, *${counts.discarded}* discarded.` +
          (reviewUrl
            ? `\n\n<${reviewUrl}|Open the overview page> to look them over and confirm.`
            : ""),
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            ":warning: Confirming hands these to the web person and freezes the " +
            "batch. Decisions can't be changed afterwards.",
        },
      ],
    },
  ];
}

/**
 * Offers the confirm control once a batch has no undecided images left.
 *
 * Completion is a computed fact — everything has been decided — while
 * confirmation is a declared intent. A machine can determine the first; only a
 * person can assert the second, which is why one is automatic and the other is
 * a button.
 */
export async function offerConfirmationIfComplete(input: {
  db: SqlClient;
  slack: SlackClient;
  channel: string;
  batchId: number;
  batchState: string;
  approverUserId?: string;
  reviewUrl?: string;
}): Promise<boolean> {
  const { db, slack, channel, batchId, batchState, approverUserId, reviewUrl } = input;

  if (batchState !== "ready_for_review") return false;

  const counts = await batchDecisionCounts(db, batchId);
  if (counts.decidable === 0 || counts.pending > 0) return false;

  // Claim the transition first, and only then post. The conditional update is
  // what makes two decisions arriving together produce one button rather than
  // two.
  if (!(await transitionBatchState(db, batchId, "ready_for_review", "complete"))) {
    return false;
  }

  try {
    await slack.postMessage({
      channel,
      text: `Batch #${batchId} is fully decided and ready to confirm.`,
      blocks: confirmBlocks(batchId, counts, reviewUrl),
    });
  } catch (error) {
    // Put the state back, or the batch is left with no button and no way to
    // ever get one.
    await setBatchState(db, batchId, "ready_for_review");
    throw error;
  }

  void approverUserId;
  return true;
}

export type ConfirmOutcome =
  | { ok: true; batchId: number; approved: number }
  | { ok: false; reason: string };

/**
 * Freezes the batch and makes it the one the web person receives.
 *
 * The pointer only ever moves here, which is what makes an unconfirmed batch
 * structurally unreachable no matter how recent it is.
 */
export async function confirmBatch(input: {
  db: SqlClient;
  batchId: number;
}): Promise<ConfirmOutcome> {
  const { db, batchId } = input;

  // Guarded on the batch's own state, not on where the pointer happens to be.
  // A confirm message stays in the channel with a live button, and clicking an
  // old one must not drag the pointer back to a superseded batch.
  if ((await getBatchState(db, batchId)) === "delivered") {
    return { ok: false, reason: `Batch #${batchId} has already been confirmed.` };
  }

  const counts = await batchDecisionCounts(db, batchId);
  if (counts.pending > 0) {
    return {
      ok: false,
      reason:
        `Batch #${batchId} still has ${counts.pending} undecided ` +
        `${counts.pending === 1 ? "photo" : "photos"}. Run \`/luma status\` to find them.`,
    };
  }

  await setBatchState(db, batchId, "delivered");
  await setDeliveredBatch(db, batchId);

  return { ok: true, batchId, approved: counts.approved };
}
