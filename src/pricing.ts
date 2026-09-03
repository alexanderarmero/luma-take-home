/**
 * Published per-image rates for the image API, and a measured estimate for
 * prompt translation. Kept in one place so the recap, the batch summary and
 * the approach documentation cannot drift apart.
 */
export const PRICING = {
  /** Image editing, image-to-image, 2048px output. */
  imageEdit: {
    "uni-1": 0.0434,
    "uni-1-max": 0.103,
  },
  /**
   * Prompt translation per product: a cached brand prefix plus one product
   * row in, two to three prompts out.
   */
  promptTranslationPerProduct: 0.0112,
} as const;

export type ImageModel = keyof (typeof PRICING)["imageEdit"];

/** Quality first; a cost spike is answered by changing this one value. */
export const DEFAULT_IMAGE_MODEL: ImageModel = "uni-1-max";

/** Candidates generated per product that carries a shot idea. */
export const CANDIDATES_PER_PRODUCT = 3;

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
