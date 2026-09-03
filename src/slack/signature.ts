import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Slack tolerates a five-minute clock skew; anything outside that window is
 * treated as a replay. Slack's own guidance uses the same bound.
 */
const MAX_SKEW_SECONDS = 5 * 60;

export type SignatureFailure =
  | "missing_headers"
  | "stale_timestamp"
  | "bad_signature";

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: SignatureFailure };

export interface VerifyInput {
  /** The exact raw request body. Re-serialising it invalidates the signature. */
  body: string;
  headers: Record<string, string | undefined>;
  signingSecret: string;
  nowMs: number;
}

/**
 * Verifies a Slack request signature.
 *
 * `nowMs` is injected rather than read from the clock so replay-window
 * behaviour is testable without freezing global time.
 */
export function verifySlackSignature({
  body,
  headers,
  signingSecret,
  nowMs,
}: VerifyInput): SignatureResult {
  const timestamp = headers["x-slack-request-timestamp"];
  const signature = headers["x-slack-signature"];

  if (!timestamp || !signature) return { ok: false, reason: "missing_headers" };

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const skew = Math.abs(Math.floor(nowMs / 1000) - timestampSeconds);
  if (skew > MAX_SKEW_SECONDS) return { ok: false, reason: "stale_timestamp" };

  // Slack signs the exact timestamp header text. Interpolating the parsed
  // number instead would produce a different base string for any header whose
  // text differs from its canonical form (a trailing ".0", a leading "+",
  // leading zeros), rejecting a legitimate request as a bad signature.
  const expected = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;

  // timingSafeEqual throws on unequal lengths, which would itself leak
  // information; compare lengths first and fail closed.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  return { ok: true };
}
