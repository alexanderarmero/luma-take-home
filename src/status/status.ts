import type { SqlClient } from "../db/client.js";
import {
  batchOutcome,
  ensureReviewToken,
  getBatchProducts,
  getDeliveredBatchId,
  getLatestBatch,
} from "../db/repository.js";
import { PRICING } from "../pricing.js";
import type { SlackClient } from "../slack/client.js";

/** Beyond this the listing stops being readable and starts being a wall. */
const MAX_LISTED = 12;

/** Only a photo that has been posted carries buttons to decide with. */
function isDecidable(jobState: string): boolean {
  return jobState === "posted" || jobState === "stored";
}

export interface StatusInput {
  db: SqlClient;
  slack?: SlackClient;
  channel?: string;
  publicBaseUrl?: string;
}

/**
 * Where the batch stands.
 *
 * Every number is a count of committed rows, never an in-memory tally, so this
 * cannot report work that did not happen. It serves two people at once: the
 * reviewer resuming a review she did not finish, and the founder seeing where
 * things stand without having to ask her.
 */
export async function buildStatusSummary(input: StatusInput): Promise<string> {
  const { db, slack, channel, publicBaseUrl } = input;

  const batch = await getLatestBatch(db);
  if (!batch) return "No batches yet. Upload a catalog to get started.";

  const [products, outcome, deliveredId] = await Promise.all([
    getBatchProducts(db, batch.id),
    batchOutcome(db, batch.id),
    getDeliveredBatchId(db),
  ]);

  let approved = 0;
  let discarded = 0;
  let pending = 0;
  let generated = 0;

  for (const product of products) {
    for (const image of product.images) {
      // Billed from the moment it is submitted, not from the moment the row
      // exists — otherwise the whole batch reads as spent the instant Generate
      // is pressed.
      if (image.kind === "styled" && image.jobState !== "pending_submit") {
        generated += 1;
      }
      if (image.jobState === "failed") continue;
      if (image.decision === "approved") approved += 1;
      else if (image.decision === "discarded") discarded += 1;
      // Only a photo that has actually been posted can be decided on. Counting
      // one still being generated as "still to review" tells the reviewer to
      // go and look at something that is not there yet.
      else if (isDecidable(image.jobState)) pending += 1;
    }
  }

  const spent = generated * PRICING.imageEdit["uni-1-max"];
  const lines: string[] = [
    `*Batch #${batch.id}* — \`${batch.sourceFilename}\``,
    `${approved} approved · ${discarded} discarded · ${pending} still to review` +
      (outcome.failed > 0 ? ` · ${outcome.failed} couldn't be generated` : ""),
    `$${spent.toFixed(2)} spent`,
  ];

  // Describes what is needed next rather than what has happened — "complete"
  // tells the reviewer nothing, "awaiting your confirmation" tells her what to
  // do.
  if (batch.state === "delivered") {
    lines.push("", ":white_check_mark: Confirmed and handed over.");
  } else if (pending === 0 && approved + discarded > 0) {
    lines.push("", ":hourglass: Everything is decided — *awaiting your confirmation*.");
  }

  const listed = products.filter((p) =>
    p.images.some((i) => isDecidable(i.jobState) && i.decision == null),
  );

  if (listed.length > 0) {
    lines.push("", `*Still needing you (${listed.length}):*`);

    const shown = listed.slice(0, MAX_LISTED);

    // In parallel, not one after another. A slash command must be answered
    // within three seconds, and a dozen sequential round trips does not fit.
    const links = await Promise.all(
      shown.map(async (product) => {
        if (!slack || !channel || !product.messageTs) return undefined;
        try {
          return await slack.getPermalink(channel, product.messageTs);
        } catch {
          // A missing link costs a tap, not the listing.
          return undefined;
        }
      }),
    );

    shown.forEach((product, index) => {
      const outstanding = product.images.filter(
        (i) => isDecidable(i.jobState) && i.decision == null,
      ).length;
      const label = `${product.sku} · ${product.productName} (${outstanding} left)`;
      const link = links[index];
      lines.push(link ? `• <${link}|${label}>` : `• ${label}`);
    });

    if (listed.length > MAX_LISTED) {
      lines.push(`…and ${listed.length - MAX_LISTED} more.`);
    }
  }

  // Under-delivery said out loud. Silence would look identical to success.
  const short = products.filter((p) => {
    const approvedHere = p.images.filter((i) => i.decision === "approved").length;
    const settled = p.images.every(
      (i) => !isDecidable(i.jobState) || i.decision != null,
    );
    return settled && approvedHere < 2 && p.images.some((i) => i.kind === "styled");
  });

  if (short.length > 0) {
    lines.push(
      "",
      `:warning: *${short.length}* ${short.length === 1 ? "product" : "products"} ` +
        `finished with fewer than two approved shots: ` +
        short.slice(0, 6).map((p) => p.sku).join(", ") +
        (short.length > 6 ? `, and ${short.length - 6} more` : ""),
    );
  }

  lines.push(
    "",
    deliveredId === null
      ? "Nothing handed over yet."
      : `Last handed over: batch #${deliveredId}.`,
  );

  if (publicBaseUrl) {
    const token = await ensureReviewToken(db, batch.id);
    lines.push(`Overview: ${publicBaseUrl}/review/${token}`);
  }

  return lines.join("\n");
}
