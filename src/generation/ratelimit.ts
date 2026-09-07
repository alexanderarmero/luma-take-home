/**
 * What the API last told us about how much room is left.
 *
 * Luma answers every request with `x-ratelimit-limit`, `x-ratelimit-remaining`
 * and `x-ratelimit-reset`, and a 429 with `Retry-After`. Before this, all four
 * were parsed, logged and thrown away — the worker submitted as fast as the
 * database could hand it work, which for a 40-product catalog is 48 requests
 * back to back against a window of 30.
 */
export interface RateLimitState {
  limit?: number | undefined;
  remaining?: number | undefined;
  resetAtUnix?: number | undefined;
  /** When we are not allowed to call again, in epoch milliseconds. */
  blockedUntilMs?: number | undefined;
  /** How many times we have been told to slow down since the process started. */
  throttleCount: number;
}

export interface RateLimiter {
  /** Resolves when it is reasonable to make the next call. */
  beforeCall(): Promise<void>;
  /** Feeds back whatever the response said. */
  observe(headers: {
    limit?: number | undefined;
    remaining?: number | undefined;
    resetAtUnix?: number | undefined;
  }): void;
  /** Records an explicit refusal, with the wait the API asked for. */
  throttled(retryAfterSeconds?: number): void;
  snapshot(): RateLimitState;
}

export interface RateLimiterOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Slow down once the window is this close to empty.
   *
   * Not zero: the reset timestamp has second granularity and other callers may
   * share the quota, so aiming for exactly empty means overshooting it.
   */
  reserve?: number;
  /** Applied when the API refuses without saying for how long. */
  defaultBackoffMs?: number;
  /** Never wait longer than this for a window to reset. */
  maxWaitMs?: number;
  log?: (event: Record<string, unknown>) => void;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const reserve = options.reserve ?? 2;
  const defaultBackoffMs = options.defaultBackoffMs ?? 10_000;
  const maxWaitMs = options.maxWaitMs ?? 60_000;
  const log = options.log ?? (() => {});

  const state: RateLimitState = { throttleCount: 0 };

  return {
    async beforeCall() {
      const waitMs = Math.min(Math.max(0, (state.blockedUntilMs ?? 0) - now()), maxWaitMs);
      if (waitMs > 0) {
        log({ event: "luma.wait", waitMs, reason: "rate_limit", ...state });
        await sleep(waitMs);
        state.blockedUntilMs = undefined;
      }
    },

    observe(headers) {
      state.limit = headers.limit;
      state.remaining = headers.remaining;
      state.resetAtUnix = headers.resetAtUnix;

      // Stop *before* the window empties rather than after being refused. A
      // 429 costs a round trip and, worse, used to cost the image an attempt.
      if (
        headers.remaining !== undefined &&
        headers.remaining <= reserve &&
        headers.resetAtUnix !== undefined
      ) {
        const until = headers.resetAtUnix * 1000;
        if (until > now()) state.blockedUntilMs = until;
      }
    },

    throttled(retryAfterSeconds) {
      state.throttleCount += 1;
      state.remaining = 0;
      const waitMs =
        retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds * 1000
          : defaultBackoffMs;
      state.blockedUntilMs = now() + waitMs;
      log({ event: "luma.throttled", waitMs, throttleCount: state.throttleCount });
    },

    snapshot() {
      return { ...state };
    },
  };
}
