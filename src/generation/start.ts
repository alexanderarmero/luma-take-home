import type { SqlClient } from "../db/client.js";
import { addImages, getBatchRows, type NewImage } from "../db/repository.js";
import { CANDIDATES_PER_PRODUCT } from "../pricing.js";
import { getPromptDirection } from "../settings/prompt.js";
import { buildBrandContext, type BrandContext } from "./brand.js";
import { buildFilename } from "./filename.js";
import { fallbackPrompts, type PromptWriter } from "./prompts.js";

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
  options: {
    /**
     * Built from the batch's own rows, so the writer knows this brand's
     * palette and the register the team writes in.
     */
    promptWriterFor?: (brand: BrandContext, direction: string) => PromptWriter;
    log?: (message: string) => void;
  } = {},
): Promise<{ styled: number; passThrough: number; translated: number }> {
  const rows = await getBatchRows(db, batchId);
  const log = options.log ?? (() => {});
  const images: NewImage[] = [];
  let styled = 0;
  let passThrough = 0;
  let translated = 0;

  // Read here rather than at the composition root: an override saved after
  // the process started must apply to the next batch, not the next deploy.
  const direction = await getPromptDirection(db);

  // Constructing the writer can throw — a bad key, a missing dependency — and
  // that must not take the batch down with it.
  let promptWriter;
  try {
    promptWriter = options.promptWriterFor?.(buildBrandContext(rows), direction.text);
  } catch (error) {
    log(`[prompts] no prompt writer available: ${(error as Error).message}`);
  }

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

    // Several genuinely different readings of the same idea, so the reviewer
    // is choosing between alternatives rather than near-identical samples.
    let prompts = fallbackPrompts(row.shotIdea, CANDIDATES_PER_PRODUCT);
    if (promptWriter) {
      try {
        prompts = await promptWriter.write({
          shotIdea: row.shotIdea,
          sku: row.sku,
          productName: row.productName,
          category: row.category,
          colour: row.colour,
          material: row.material,
          count: CANDIDATES_PER_PRODUCT,
        });
        translated += 1;
      } catch (error) {
        // The shot idea unchanged is a worse prompt but a working batch. A
        // hiccup in translation must not be able to stop the pipeline.
        log(`[prompts] ${row.sku} fell back to the raw shot idea: ${(error as Error).message}`);
      }
    }

    for (let slot = 1; slot <= CANDIDATES_PER_PRODUCT; slot++) {
      images.push({
        sku: row.sku,
        productName: row.productName,
        slot,
        kind: "styled",
        filename: buildFilename({ sku: row.sku, slot, shotIdea: row.shotIdea }),
        prompt: prompts[slot - 1] ?? row.shotIdea,
      });
      styled += 1;
    }
  }

  await addImages(db, batchId, images);
  return { styled, passThrough, translated };
}
