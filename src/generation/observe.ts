/**
 * One structured line per Luma call.
 *
 * JSON rather than prose because the question being asked of these logs is
 * always an aggregate — *which* failure code, *how often*, *how long before it
 * gave up* — and prose has to be re-parsed by hand every time. Railway's log
 * search matches on the raw line either way, so `luma.call` finds all of them
 * and `"outcome":"failed"` finds the ones that matter.
 */
export interface LumaCallEvent {
  event: "luma.call";
  op: "submit" | "poll";
  outcome: "ok" | "pending" | "failed" | "error";
  /** Our image id, so a line can be traced back to a product. */
  imageId?: string | undefined;
  generationId?: string | undefined;
  durationMs: number;
  status?: number | undefined;
  failureCode?: string | null | undefined;
  failureReason?: string | null | undefined;
  retryable?: boolean | undefined;
  /** Straight from the response headers, so pacing is auditable after the fact. */
  rateLimitRemaining?: number | undefined;
  rateLimitLimit?: number | undefined;
  message?: string | undefined;
}

export type Observer = (event: Record<string, unknown>) => void;

/** Writes one JSON object per line to stdout. */
export const consoleObserver: Observer = (event) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }));
};

export const noopObserver: Observer = () => {};
