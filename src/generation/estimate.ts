/**
 * A rough wall-clock estimate for a batch, in minutes.
 *
 * Generations run concurrently upstream, so the model is: wait out one
 * generation, then spend a couple of seconds per image downloading, storing
 * and posting it — posting to Slack being the slowest step at roughly one
 * message a second.
 *
 * Deliberately generous. Someone told "about five minutes" who waits four is
 * fine; someone told "about one" who waits four goes looking for a bug.
 */
export function estimateMinutes(imageCount: number): number {
  if (imageCount === 0) return 0;
  const seconds = 45 + imageCount * 3;
  return Math.max(1, Math.ceil(seconds / 60));
}

export function describeWait(imageCount: number): string {
  const minutes = estimateMinutes(imageCount);
  return minutes === 1 ? "about a minute" : `about ${minutes} minutes`;
}
