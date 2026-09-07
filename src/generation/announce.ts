import {
  ensureReviewToken,
  setBatchState,
  setIntroMessageTs,
} from "../db/repository.js";
import type { SqlClient } from "../db/client.js";
import {
  CANDIDATES_PER_PRODUCT,
  DEFAULT_IMAGE_MODEL,
  formatUsd,
  PRICING,
  type ImageModel,
} from "../pricing.js";
import type { SlackClient } from "../slack/client.js";
import type { BrandContext } from "./brand.js";
import type { PromptWriter } from "./prompts.js";
import { describeWait } from "./estimate.js";
import { startGeneration } from "./start.js";

export interface AnnounceInput {
  db: SqlClient;
  slack: SlackClient;
  channel: string;
  batchId: number;
  publicBaseUrl?: string | undefined;
  log?: ((message: string) => void) | undefined;
  promptWriterFor?: ((brand: BrandContext, direction: string) => PromptWriter) | undefined;
  model?: ImageModel;
}

/**
 * What a started batch costs, from what it actually decided to make.
 *
 * Recomputed rather than carried over from the recap: the recap describes a
 * file, this describes a batch, and only the second one is a commitment. They
 * agree because both derive from the same rows, but the estimate that gets
 * quoted publicly is the one taken at the moment of spending.
 */
export function estimateBatchCost(
  counts: { styled: number },
  model: ImageModel = DEFAULT_IMAGE_MODEL,
): number {
  const products = counts.styled / CANDIDATES_PER_PRODUCT;
  const cost =
    counts.styled * PRICING.imageEdit[model] +
    products * PRICING.promptTranslationPerProduct;
  return Number(cost.toFixed(4));
}

/**
 * Starts a batch and tells the channel, in that order of visibility but not of
 * time: the announcement goes first.
 *
 * Turning sixteen shot ideas into prompts is a minute or more of API calls.
 * Doing that before saying anything leaves the channel silent, which is
 * indistinguishable from a button that does nothing.
 */
export async function startBatchAndAnnounce(input: AnnounceInput): Promise<void> {
  const { db, slack, channel, batchId, publicBaseUrl } = input;
  const model = input.model ?? DEFAULT_IMAGE_MODEL;
  const log = input.log ?? ((message: string) => console.log(message));

  try {
    const reviewToken = await ensureReviewToken(db, batchId);
    const overviewUrl = publicBaseUrl ? `${publicBaseUrl}/review/${reviewToken}` : null;

    const intro = await slack.postMessage({
      channel,
      text: [
        // No @-mention here: the one ping per batch is the "ready for
        // review" one at the end, and a second would train people to ignore
        // both.
        `*Batch #${batchId} has started.*`,
        "",
        "I'm writing the prompts now, then generating. *Nothing will appear " +
          "straight away* — photos are posted once a product's whole set has " +
          "finished, so they arrive product by product.",
        "",
        "You don't need to wait here — I'll mention you once the whole batch " +
          "is ready to review.",
        ...(overviewUrl ? ["", `*Overview page:* ${overviewUrl}`] : []),
        "",
        // Said now rather than at the end: signing in takes a moment and the
        // moment to spend it is while the photographs are being made, not
        // when someone is finally sitting down to decide.
        "*FOR ADMINS* _Before_ you can approve anything, run `/luma signin`. It sends you " +
          "a private link that lasts a day — anyone can open the overview " +
          "page and look, but deciding needs that sign-in. Do it now and it " +
          "will be ready when the photos are.",
      ].join("\n"),
    });

    // Pinned so it stays reachable after the batch's own photographs have
    // pushed it out of view — this is the message carrying the overview link
    // and the sign-in instruction, which are exactly what someone coming back
    // two days later needs. Failing to pin costs a convenience, not a batch.
    try {
      await slack.pinMessage({ channel, ts: intro.ts });
      await setIntroMessageTs(db, batchId, intro.ts);
    } catch (error) {
      log(`[announce] could not pin the intro: ${(error as Error).message}`);
    }

    const counts = await startGeneration(db, batchId, {
      ...(input.promptWriterFor ? { promptWriterFor: input.promptWriterFor } : {}),
      log: (message) => console.log(message),
    });
    await setBatchState(db, batchId, "generating");

    const total = counts.styled + counts.passThrough;
    const cost = estimateBatchCost(counts, model);

    // The estimate used to live in a recap posted to the channel. That recap
    // is now private to whoever uploaded the file, so the number has to be
    // said here — the spend is the team's business even when the upload isn't.
    await slack.postMessage({
      channel,
      text:
        `Generating *${counts.styled}* styled photos and copying ` +
        `*${counts.passThrough}* originals across — *${total}* to review in ` +
        `all, about ${formatUsd(cost)} of ${model}. This usually takes ` +
        `${describeWait(total)}.`,
    });
  } catch (error) {
    // Without this the failure reaches stderr and nobody is told, which looks
    // exactly like a button that does nothing.
    console.error("[generate] failed", error);
    await slack
      .postMessage({
        channel,
        text:
          `I couldn't start batch #${batchId}: ${(error as Error).message}\n` +
          "Nothing has been charged. Upload the file again to retry.",
      })
      .catch(() => {});
  }
}
