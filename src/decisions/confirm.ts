import type { SqlClient } from "../db/client.js";
import {
  batchCounts,
  getDeliveredBatchId,
  setBatchState,
  setDeliveredBatch,
} from "../db/repository.js";
import type { Block, SlackClient } from "../slack/client.js";

export const CONFIRM_ACTION_ID = "confirm_batch";

/**
 * Posted the moment a batch is fully decided.
 *
 * A new message rather than an edit to the one that opened the batch: after
 * scrolling a channel of products, the reviewer is at the bottom, and a button
 * they passed an hour ago is one they will not go back for. It also cannot be
 * pressed early, because it does not exist until it applies.
 */
function confirmBlocks(
  batchId: number,
  counts: { approved: number; discarded: number },
): Block[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*Batch #${batchId} — everything has been decided.*\n` +
          `*${counts.approved}* approved, *${counts.discarded}* discarded.`,
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
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: CONFIRM_ACTION_ID,
          text: { type: "plain_text", text: "Confirm and hand over", emoji: true },
          style: "primary",
          value: String(batchId),
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
}): Promise<boolean> {
  const { db, slack, channel, batchId, batchState, approverUserId } = input;

  // Only from ready_for_review: the transition is the guard against offering
  // the same batch twice.
  if (batchState !== "ready_for_review") return false;

  const counts = await batchCounts(db, batchId);
  if (counts.total === 0 || counts.pending > 0) return false;

  await setBatchState(db, batchId, "complete");
  await slack.postMessage({
    channel,
    text: `Batch #${batchId} is fully decided and ready to confirm.`,
    blocks: confirmBlocks(batchId, counts),
  });
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
  actorUserId: string;
  approverUserId: string;
}): Promise<ConfirmOutcome> {
  const { db, batchId, actorUserId, approverUserId } = input;

  if (actorUserId !== approverUserId) {
    return { ok: false, reason: "Only Ellie can confirm a batch." };
  }

  const alreadyDelivered = await getDeliveredBatchId(db);
  if (alreadyDelivered === batchId) {
    return { ok: false, reason: `Batch #${batchId} has already been confirmed.` };
  }

  const counts = await batchCounts(db, batchId);
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
