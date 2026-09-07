import { LUMA_CONCURRENT_GENERATIONS } from "./capacity.js";

/**
 * How long one generation takes, end to end.
 *
 * Measured, not assumed: 93 seconds at the median across 27 submit-to-complete
 * pairs, 114s at p95 and 135s worst (F16.3). This file carried 45 seconds
 * before there were logs to read, which was a guess inherited from a time when
 * nothing had ever been timed. The median is the right figure for a promise
 * made about a whole batch — every wave rolls the same dice, so the tail
 * averages out rather than compounding.
 */
const SECONDS_PER_GENERATION = 93;

/**
 * How long a freed slot sits unused before the worker takes it.
 *
 * Capacity is freed by a generation finishing, and the only way we find that
 * out is by asking. D60 leaves a generation alone for 8 seconds between polls
 * once it is running, so that is the worst case for noticing — and the worst
 * case is the one to quote, because this estimate errs long by design.
 */
const SECONDS_TO_NOTICE_A_FREE_SLOT = 8;

/**
 * Local work per image, generated or not: a download, a store write, and a
 * Slack post. The post is the slow part, at roughly a message a second.
 */
const SECONDS_PER_IMAGE = 3;

/**
 * A rough wall-clock estimate for a batch, in minutes.
 *
 * Three parts, in the order they dominate:
 *
 *  - **Generations run in waves.** Luma keeps three of ours outstanding at a
 *    time, so forty-eight styled photographs are sixteen waves, not one batch
 *    of forty-eight. This is the part the previous version got wrong: it was
 *    written before that ceiling existed and modelled the wait as "one
 *    generation, then a couple of seconds per image", which quoted five
 *    minutes for a catalog that measurement now puts near thirty. Someone
 *    watching a batch run six times longer than promised has been given a
 *    reason to go looking for a bug that isn't there.
 *  - **Pass-throughs are not generations.** Copying a customer's own photo
 *    makes no Luma call and waits on no capacity, so counting it as though it
 *    did inflates every mixed batch. That is why this takes the two counts
 *    separately and no longer accepts one total — collapsing them is precisely
 *    the mistake being fixed.
 *  - **Local work is additive, not overlapped.** The worker advances one job
 *    by one stage at a time, so an image being uploaded to Slack is time in
 *    which nothing is being submitted or polled.
 *
 * Deliberately generous. Someone told "about five minutes" who waits four is
 * fine; someone told "about one" who waits four goes looking for a bug.
 */
export function estimateMinutes(
  counts: { styled: number; passThrough: number },
  /** Overridable for the same reason the worker's cap is: it is the account's, not ours. */
  concurrentGenerations: number = LUMA_CONCURRENT_GENERATIONS,
): number {
  const total = counts.styled + counts.passThrough;
  if (total === 0) return 0;

  const waves = Math.ceil(counts.styled / Math.max(1, concurrentGenerations));
  const seconds =
    waves * (SECONDS_PER_GENERATION + SECONDS_TO_NOTICE_A_FREE_SLOT) +
    total * SECONDS_PER_IMAGE;

  return Math.max(1, Math.ceil(seconds / 60));
}

export function describeWait(counts: { styled: number; passThrough: number }): string {
  const minutes = estimateMinutes(counts);
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}
