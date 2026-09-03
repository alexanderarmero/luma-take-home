import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySlackSignature } from "./signature.js";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";

/** Produce the headers Slack would send for a given body + timestamp. */
function sign(body: string, timestampSeconds: number, secret = SECRET) {
  const base = `v0:${timestampSeconds}:${body}`;
  const digest = createHmac("sha256", secret).update(base).digest("hex");
  return {
    "x-slack-request-timestamp": String(timestampSeconds),
    "x-slack-signature": `v0=${digest}`,
  };
}

const NOW = 1_700_000_000_000; // fixed clock, ms
const NOW_S = Math.floor(NOW / 1000);

describe("verifySlackSignature", () => {
  it("accepts a correctly signed request", () => {
    const body = "token=abc&command=%2Fluma&text=ping";
    const result = verifySlackSignature({
      body,
      headers: sign(body, NOW_S),
      signingSecret: SECRET,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a signature computed with a different secret", () => {
    const body = "command=%2Fluma";
    const result = verifySlackSignature({
      body,
      headers: sign(body, NOW_S, "a-different-secret"),
      signingSecret: SECRET,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a body that was tampered with after signing", () => {
    const headers = sign("command=%2Fluma&text=ping", NOW_S);
    const result = verifySlackSignature({
      body: "command=%2Fluma&text=DROP+TABLE",
      headers,
      signingSecret: SECRET,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a replayed request older than the skew window", () => {
    const body = "command=%2Fluma";
    const sixMinutesAgo = NOW_S - 6 * 60;
    const result = verifySlackSignature({
      body,
      headers: sign(body, sixMinutesAgo),
      signingSecret: SECRET,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("accepts a request just inside the skew window", () => {
    const body = "command=%2Fluma";
    const fourMinutesAgo = NOW_S - 4 * 60;
    const result = verifySlackSignature({
      body,
      headers: sign(body, fourMinutesAgo),
      signingSecret: SECRET,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: true });
  });

  it("rejects a timestamp far in the future", () => {
    const body = "command=%2Fluma";
    const result = verifySlackSignature({
      body,
      headers: sign(body, NOW_S + 6 * 60),
      signingSecret: SECRET,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
  });

  it("rejects a request with no signature headers", () => {
    const result = verifySlackSignature({
      body: "command=%2Fluma",
      headers: {},
      signingSecret: SECRET,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "missing_headers" });
  });

  it("rejects a malformed signature without throwing on length mismatch", () => {
    const result = verifySlackSignature({
      body: "command=%2Fluma",
      headers: {
        "x-slack-request-timestamp": String(NOW_S),
        "x-slack-signature": "v0=deadbeef",
      },
      signingSecret: SECRET,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a non-numeric timestamp", () => {
    const result = verifySlackSignature({
      body: "command=%2Fluma",
      headers: {
        "x-slack-request-timestamp": "not-a-number",
        "x-slack-signature": "v0=deadbeef",
      },
      signingSecret: SECRET,
      nowMs: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "stale_timestamp" });
  });
});
