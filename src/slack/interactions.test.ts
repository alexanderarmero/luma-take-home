import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createApp } from "./app.js";
import { createFakeSlack } from "./testing.js";
import { VERIFY_ACTION_ID } from "./verify.js";

const SECRET = "test-signing-secret";
const NOW = 1_700_000_000_000;

let db: TestDb;
let deferred: Array<() => Promise<void>>;
const slack = createFakeSlack();

beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

beforeEach(() => {
  deferred = [];
  slack.reset();
});

function app() {
  return createApp({
    signingSecret: SECRET,
    now: () => NOW,
    defer: (task) => {
      deferred.push(task);
    },
    db,
    slack,
    reviewChannelId: "C_REVIEW",
    approverUserId: "U_ELLIE",
  });
}

async function drain() {
  for (const task of deferred) await task();
  deferred = [];
}

function signedInteraction(payload: unknown, opts: { secret?: string } = {}) {
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  const ts = Math.floor(NOW / 1000);
  const digest = createHmac("sha256", opts.secret ?? SECRET)
    .update(`v0:${ts}:${body}`)
    .digest("hex");

  return new Request("http://localhost/slack/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": String(ts),
      "x-slack-signature": `v0=${digest}`,
    },
    body,
  });
}

const blockAction = (actionId: string, userId = "U_ELLIE") => ({
  type: "block_actions",
  user: { id: userId },
  channel: { id: "C_REVIEW" },
  message: { ts: "1700000000.000100" },
  actions: [{ action_id: actionId, value: "probe-1-plain-message" }],
});

describe("POST /slack/interactions", () => {
  it("rejects a payload with no signature", async () => {
    const res = await app().request(
      new Request("http://localhost/slack/interactions", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "payload=%7B%7D",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const res = await app().request(
      signedInteraction(blockAction(VERIFY_ACTION_ID), { secret: "wrong" }),
    );
    expect(res.status).toBe(401);
  });

  it("acknowledges immediately and does the work afterwards", async () => {
    // Slack drops anything not answered in three seconds, so the response
    // must not wait on a chat.update round trip.
    const res = await app().request(signedInteraction(blockAction(VERIFY_ACTION_ID)));
    expect(res.status).toBe(200);
    expect(slack.updates).toHaveLength(0);
    expect(deferred).toHaveLength(1);
  });

  it("rewrites the probe message in place when the button is tapped", async () => {
    await app().request(signedInteraction(blockAction(VERIFY_ACTION_ID)));
    await drain();

    expect(slack.updates).toHaveLength(1);
    expect(slack.updates[0]!.ts).toBe("1700000000.000100");
    expect(slack.updates[0]!.text).toContain("U_ELLIE");
    expect(slack.updates[0]!.text.toLowerCase()).toContain("works");
  });

  it("answers an unrecognised action without leaving Slack hanging", async () => {
    const res = await app().request(signedInteraction(blockAction("something_else")));
    expect(res.status).toBe(200);
    await drain();
    expect(slack.updates).toHaveLength(0);
  });

  it("ignores a payload that is not a block action", async () => {
    const res = await app().request(
      signedInteraction({ type: "view_submission", user: { id: "U1" } }),
    );
    expect(res.status).toBe(200);
  });

  it("survives a malformed payload rather than returning a server error", async () => {
    const body = "payload=not-json";
    const ts = Math.floor(NOW / 1000);
    const digest = createHmac("sha256", SECRET)
      .update(`v0:${ts}:${body}`)
      .digest("hex");

    const res = await app().request(
      new Request("http://localhost/slack/interactions", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": String(ts),
          "x-slack-signature": `v0=${digest}`,
        },
        body,
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe("/luma verify", () => {
  it("acknowledges first and posts the probes afterwards", async () => {
    const body = new URLSearchParams({
      command: "/luma",
      text: "verify",
      user_id: "U_ELLIE",
      channel_id: "C_REVIEW",
    }).toString();
    const ts = Math.floor(NOW / 1000);
    const digest = createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");

    const res = await app().request(
      new Request("http://localhost/slack/commands", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-slack-request-timestamp": String(ts),
          "x-slack-signature": `v0=${digest}`,
        },
        body,
      }),
    );

    expect(res.status).toBe(200);
    expect(slack.posts).toHaveLength(0);
    expect(deferred).toHaveLength(1);
  });
});
