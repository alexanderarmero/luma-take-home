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
  const lines: string[] = [
    `*${filename}* — I've read your file. Here is exactly what pressing ` +
      `Generate would do.`,
    "",
    "*What's in the file*",
    `I found ${count(plan.totalRows, "product")}.`,
    `• ${plan.rowsWithShotIdea} ${verb(plan.rowsWithShotIdea)} something ` +
      `written in the Shot Idea column.`,
    `• ${plan.rowsWithoutShotIdea} ${verb(plan.rowsWithoutShotIdea)} that ` +
      `column blank.`,
    "",
    "*What I would make*",
  ];

  if (plan.rowsWithShotIdea > 0) {
    lines.push(
      `For every product that has a shot idea (${plan.rowsWithShotIdea} of ` +
        `them), I would create ${CANDIDATES_PER_PRODUCT} different styled ` +
        `photos for you to choose between. That is ` +
        `${count(plan.imagesToGenerate, "new photo")} in total.`,
    );
  } else {
    lines.push(
      "No product has a shot idea written in, so I would not create any new " +
        "styled photos at all.",
    );
  }

  if (plan.rowsWithoutShotIdea > 0) {
    lines.push(
      "",
      `For every product with a blank Shot Idea (${plan.rowsWithoutShotIdea} ` +
        `of them), I would not invent anything. I would use that product's ` +
        `existing white-background photo exactly as it is, unchanged. That is ` +
        `${count(plan.passThroughImages, "photo")}, and they cost nothing ` +
        `because nothing is generated for them.`,
    );
  }

  lines.push(
    "",
    "*What you would review*",
    `${count(plan.totalImagesToReview, "image")}, on one overview page — ` +
      `each product's shots side by side, so choosing between them is a ` +
      `comparison rather than a scroll. Every set is also posted to the ` +
      `channel with its own thread, for talking about it.`,
    "",
    "*What it would cost*",
    plan.estimatedCostUsd > 0
      ? `${formatUsd(plan.estimatedCostUsd)} in total, using the ` +
        `${plan.model} model. Only the ${plan.imagesToGenerate} styled photos ` +
        `cost anything.`
      : "Nothing at all. There are no styled photos to generate.",
    "",
    ":warning: Nothing has been generated and nothing has been charged yet. " +
      "Press *Generate* below to start.",
  );

  if (warnings.length > 0) {
    lines.push(
      "",
      "*Rows I could not use*",
      "These rows were left out of everything above. The rest of the file is " +
        "unaffected.",
    );
    for (const warning of warnings) lines.push(`• ${warning}`);
  }

  return lines.join("\n");
}

/** "1 product" / "3 products" — verbose copy makes a stray plural obvious. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function verb(n: number): string {
  return n === 1 ? "has" : "have";
}
