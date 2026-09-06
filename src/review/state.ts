import type { SqlClient } from "../db/client.js";
import {
  batchCounts,
  findBatchByReviewToken,
  getBatchProducts,
} from "../db/repository.js";
import { PRICING, type ImageModel } from "../pricing.js";

export type CandidateState = "generating" | "ready" | "approved" | "discarded" | "failed";

export interface CandidateView {
  imageId: string;
  filename: string;
  /** Absent until the image has been stored. */
  imageUrl: string | null;
  prompt: string | null;
  state: CandidateState;
  failureReason: string | null;
}

export interface ProductView {
  sku: string;
  productName: string;
  shotIdea: string | null;
  isPassThrough: boolean;
  /** Straight into this product's Slack conversation. */
  threadUrl: string | null;
  /**
   * Whether the set has been posted at all.
   *
   * Distinct from `threadUrl`: the permalink call can fail while the thread
   * exists perfectly well, and a regenerated shot needs the thread, not the
   * link to it.
   */
  hasThread: boolean;
  candidates: CandidateView[];
}

export interface ReviewState {
  batchId: number;
  sourceFilename: string;
  batchState: string;
  /** True while any candidate is still being generated. */
  inProgress: boolean;
  totals: {
    products: number;
    images: number;
    ready: number;
    approved: number;
    discarded: number;
    pending: number;
    failed: number;
  };
  spentUsd: number;
  /** Changes whenever anything the page shows has changed. */
  revision: string;
  products: ProductView[];
}

function candidateState(
  jobState: string,
  decision: "approved" | "discarded" | null | undefined,
): CandidateState {
  if (decision === "approved") return "approved";
  if (decision === "discarded") return "discarded";
  if (jobState === "failed") return "failed";
  if (jobState === "posted" || jobState === "stored") return "ready";
  return "generating";
}

/**
 * Everything the overview page shows, assembled from committed rows only.
 *
 * Nothing here is cached or counted in memory, so the page cannot report
 * progress that did not happen — the same rule `/luma status` follows.
 */
export async function buildReviewState(
  db: SqlClient,
  token: string,
  model: ImageModel = "uni-1-max",
): Promise<ReviewState | null> {
  const batch = await findBatchByReviewToken(db, token);
  if (!batch) return null;

  const [products, counts] = await Promise.all([
    getBatchProducts(db, batch.id),
    batchCounts(db, batch.id),
  ]);

  let ready = 0;
  let failed = 0;
  let generating = 0;
  let generated = 0;

  const views: ProductView[] = products.map((product) => {
    const isPassThrough = product.images.some((i) => i.kind === "pass_through");

    const candidates: CandidateView[] = product.images.map((image) => {
      const state = candidateState(image.jobState, image.decision);
      if (state === "failed") failed += 1;
      else if (state === "generating") generating += 1;
      else ready += 1;
      // Billed once submitted, not once the row exists.
      if (image.kind === "styled" && image.jobState !== "pending_submit") {
        generated += 1;
      }

      return {
        imageId: image.imageId,
        filename: image.filename,
        imageUrl: image.objectKey
          ? `/img/${image.objectKey.replace(/^images\//, "").replace(/\.jpg$/, "")}`
          : null,
        prompt: image.prompt,
        state,
        failureReason: image.failureCode,
      };
    });

    return {
      sku: product.sku,
      productName: product.productName,
      shotIdea: product.shotIdea,
      isPassThrough,
      threadUrl: product.permalink,
      hasThread: product.messageTs !== null,
      candidates,
    };
  });

  return {
    batchId: batch.id,
    sourceFilename: batch.sourceFilename,
    batchState: batch.state,
    inProgress: generating > 0,
    totals: {
      products: views.length,
      images: counts.total,
      ready,
      approved: counts.approved,
      discarded: counts.discarded,
      pending: counts.pending,
      failed,
    },
    // Only generated images cost anything; pass-throughs are free.
    spentUsd: Number((generated * PRICING.imageEdit[model]).toFixed(4)),
    revision: [ready, failed, counts.approved, counts.discarded, counts.total].join("-"),
    products: views,
  };
}
