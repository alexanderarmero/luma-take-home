import type { SqlClient } from "../db/client.js";
import {
  batchCounts,
  getDeliveredBatchId,
  getLatestBatch,
} from "../db/repository.js";

/**
 * The status message.
 *
 * Every number here is a count of committed rows, never an in-memory tally —
 * so this cannot report work that did not happen. Ticket 12 grows this into
 * per-image state with deep links; this version exists early because it is
 * also the observability the rest of the build needs.
 */
export async function buildStatusSummary(db: SqlClient): Promise<string> {
  const batch = await getLatestBatch(db);
  if (!batch) return "No batches yet. Upload a catalog to get started.";

  const counts = await batchCounts(db, batch.id);
  const deliveredId = await getDeliveredBatchId(db);

  const lines = [
    `*Batch #${batch.id}* — \`${batch.sourceFilename}\` (${batch.state})`,
    `${counts.total} images · ${counts.approved} approved · ` +
      `${counts.discarded} discarded · ${counts.pending} pending`,
  ];

  lines.push(
    deliveredId === null
      ? "Nothing delivered yet."
      : `Last delivered: batch #${deliveredId}.`,
  );

  return lines.join("\n");
}
