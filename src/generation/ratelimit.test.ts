import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./ratelimit.js";

/** A clock and a sleep that record rather than pass time. */
function harness(startMs = 1_700_000_000_000) {
  let clock = startMs;
  const slept: number[] = [];
  const limiter = createRateLimiter({
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    reserve: 2,
    defaultBackoffMs: 10_000,
  });
  return { limiter, slept, advance: (ms: number) => (clock += ms), at: () => clock };
}

describe("pacing against the window the API reports", () => {
  it("does not wait while there is room", async () => {
    const { limiter, slept } = harness();
    limiter.observe({ limit: 30, remaining: 18, resetAtUnix: 1_700_000_060 });

    await limiter.beforeCall();
    expect(slept).toHaveLength(0);
  });

  it("stops before the window empties, not after being refused", async () => {
    // A 429 costs a round trip and, before this, cost the image an attempt.
    // Reserving a couple of requests avoids paying for the lesson.
    const { limiter, slept } = harness();
    limiter.observe({ limit: 30, remaining: 1, resetAtUnix: 1_700_000_030 });

    await limiter.beforeCall();
    expect(slept).toEqual([30_000]);
  });

  it("waits exactly as long as a refusal asked for", async () => {
    const { limiter, slept } = harness();
    limiter.throttled(45);

    await limiter.beforeCall();
    expect(slept).toEqual([45_000]);
  });

  it("falls back to a fixed backoff when told nothing", async () => {
    const { limiter, slept } = harness();
    limiter.throttled(undefined);

    await limiter.beforeCall();
    expect(slept).toEqual([10_000]);
  });

  it("waits once, not on every subsequent call", async () => {
    const { limiter, slept } = harness();
    limiter.throttled(20);

    await limiter.beforeCall();
    await limiter.beforeCall();
    expect(slept).toEqual([20_000]);
  });

  it("ignores a reset time that has already passed", async () => {
    const { limiter, slept } = harness();
    limiter.observe({ limit: 30, remaining: 0, resetAtUnix: 1_600_000_000 });

    await limiter.beforeCall();
    expect(slept).toHaveLength(0);
  });

  it("never waits longer than its ceiling", async () => {
    // A malformed or far-future reset header must not park the worker for an
    // hour with no way to notice.
    const { limiter, slept } = harness();
    limiter.throttled(86_400);

    await limiter.beforeCall();
    expect(slept).toEqual([60_000]);
  });

  it("counts refusals, so /healthz can show whether this is the problem", () => {
    const { limiter } = harness();
    limiter.throttled(5);
    limiter.throttled(5);

    const snapshot = limiter.snapshot();
    expect(snapshot.throttleCount).toBe(2);
    expect(snapshot.remaining).toBe(0);
  });

  it("reports what the API last said", () => {
    const { limiter } = harness();
    limiter.observe({ limit: 30, remaining: 12, resetAtUnix: 1_700_000_060 });

    expect(limiter.snapshot()).toMatchObject({
      limit: 30,
      remaining: 12,
      resetAtUnix: 1_700_000_060,
    });
  });
});
