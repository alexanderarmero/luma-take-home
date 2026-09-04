import type { SqlClient } from "../db/client.js";
import { addImages, getBatchRows, type NewImage } from "../db/repository.js";
import { CANDIDATES_PER_PRODUCT } from "../pricing.js";
import { buildFilename } from "./filename.js";

/**
 * Turns an ingested catalog into the images that will be generated.
 *
 * A row with a shot idea becomes several candidates to choose between; a row
 * without becomes exactly one pass-through of the product's own photo. Both
 * paths produce a reviewable image, so a batch covers every product in the
 * file rather than quietly dropping the blanks.
 */
export async function startGeneration(
  db: SqlClient,
  batchId: number,
): Promise<{ styled: number; passThrough: number }> {
  const rows = await getBatchRows(db, batchId);
  const images: NewImage[] = [];
  let styled = 0;
  let passThrough = 0;

  for (const row of rows) {
    if (row.shotIdea === null) {
      images.push({
        sku: row.sku,
        productName: row.productName,
        slot: 1,
        kind: "pass_through",
        filename: buildFilename({ sku: row.sku, slot: 1, shotIdea: null }),
        prompt: null,
      });
      passThrough += 1;
      continue;
    }

    for (let slot = 1; slot <= CANDIDATES_PER_PRODUCT; slot++) {
      images.push({
        sku: row.sku,
        productName: row.productName,
        slot,
        kind: "styled",
        filename: buildFilename({ sku: row.sku, slot, shotIdea: row.shotIdea }),
        // Ticket 05 sends the shot idea through unchanged. Turning it into
        // several genuinely different prompts is the next ticket; proving the
        // pipeline comes first.
        prompt: row.shotIdea,
      });
      styled += 1;
    }
  }

  await addImages(db, batchId, images);
  return { styled, passThrough };
}
