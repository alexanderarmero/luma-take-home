import {
  CANDIDATES_PER_PRODUCT,
  DEFAULT_IMAGE_MODEL,
  formatUsd,
  PRICING,
  type ImageModel,
} from "../pricing.js";
import type { CatalogRow } from "./parse.js";

export interface BatchPlan {
  totalRows: number;
  rowsWithShotIdea: number;
  rowsWithoutShotIdea: number;
  /** Only rows with a shot idea are generated. */
  imagesToGenerate: number;
  /** Blank shot ideas contribute their original photo, free. */
  passThroughImages: number;
  totalImagesToReview: number;
  estimatedCostUsd: number;
  model: ImageModel;
}

export function planBatch(
  rows: CatalogRow[],
  model: ImageModel = DEFAULT_IMAGE_MODEL,
): BatchPlan {
  const withShotIdea = rows.filter((r) => r.shotIdea !== null).length;
  const withoutShotIdea = rows.length - withShotIdea;

  const imagesToGenerate = withShotIdea * CANDIDATES_PER_PRODUCT;
  const generationCost = imagesToGenerate * PRICING.imageEdit[model];
  const translationCost = withShotIdea * PRICING.promptTranslationPerProduct;

  return {
    totalRows: rows.length,
    rowsWithShotIdea: withShotIdea,
    rowsWithoutShotIdea: withoutShotIdea,
    imagesToGenerate,
    passThroughImages: withoutShotIdea,
    totalImagesToReview: imagesToGenerate + withoutShotIdea,
    estimatedCostUsd: Number((generationCost + translationCost).toFixed(4)),
    model,
  };
}

/**
 * The message shown before anything is generated.
 *
 * This is the answer to "don't burn our budget on stuff she'll reject" — not a
 * smaller bill, but seeing the bill first. It costs nothing to produce, since
 * it is validation that has to happen anyway with a button attached.
 */
export function buildRecap(
  plan: BatchPlan,
  warnings: string[],
  filename: string,
): string {
  const lines = [
    `*${filename}* — here's what I'd do.`,
    "",
    `• *${plan.totalRows}* product rows`,
    `• *${plan.rowsWithShotIdea}* have a shot idea → *${plan.imagesToGenerate}* styled shots ` +
      `(${CANDIDATES_PER_PRODUCT} options each)`,
    `• *${plan.rowsWithoutShotIdea}* have none → their original photo, unchanged and free`,
    `• *${plan.totalImagesToReview}* images to review in total`,
    "",
    `Estimated cost: *${formatUsd(plan.estimatedCostUsd)}* (${plan.model}).`,
    "Nothing has been generated yet — press Generate when you're happy.",
  ];

  if (warnings.length > 0) {
    lines.push("", "_Worth a look:_");
    for (const warning of warnings) lines.push(`• ${warning}`);
  }

  return lines.join("\n");
}
