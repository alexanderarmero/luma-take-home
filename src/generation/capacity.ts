/**
 * How many generations Luma will run for us at once.
 *
 * Not a tuning knob and not a guess — arithmetic on two numbers Luma states in
 * its own refusal:
 *
 *     HTTP 429 {"detail":"Concurrent generation capacity reached
 *                         (limit=10 weight units; this request needs 3).
 *                         Wait for existing jobs to complete."}
 *
 * Ten units of capacity at three units for an `image_edit` on `uni-1-max` is
 * three at a time, with one unit permanently idle because three does not
 * divide ten.
 *
 * Distinct from the request-rate window, which is the limit this was first
 * mistaken for: the refusal above arrived with 21 of 30 window units still
 * free, so pacing between calls could never have prevented it. Capacity is
 * freed by a generation finishing, not by time passing.
 *
 * It lives alone in its own file because two distant things need it and must
 * agree: the worker, which must not start a fourth generation, and the batch
 * estimate, which must not promise a batch will finish as though it could.
 * They disagreed once already — the estimate was written before this ceiling
 * existed, kept assuming unbounded upstream concurrency, and quoted five
 * minutes for a catalog that measurement now puts near thirty.
 */
export const LUMA_CONCURRENT_GENERATIONS = 3;
