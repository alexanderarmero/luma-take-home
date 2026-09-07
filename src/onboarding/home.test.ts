import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createApp } from "../slack/app.js";
import { createFakeSlack, type FakeSlack } from "../slack/testing.js";
import { buildHomeView } from "./home.js";

const SECRET = "test-signing-secret";
const NOW = 1_700_000_000_000;

let db: TestDb;
let slack: FakeSlack;
let deferred: Array<() => Promise<void>>;

beforeEach(async () => {
  db = await createTestDb();
  slack = createFakeSlack();
  deferred = [];
});
afterEach(async () => {
  await db?.close();
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

async function flush() {
  for (const task of deferred.splice(0)) await task();
}

function event(body: unknown) {
  const raw = JSON.stringify(body);
  const ts = Math.floor(NOW / 1000);
  const digest = createHmac("sha256", SECRET).update(`v0:${ts}:${raw}`).digest("hex");
  return new Request("http://localhost/slack/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": String(ts),
      "x-slack-signature": `v0=${digest}`,
    },
    body: raw,
  });
}

const text = () => JSON.stringify(buildHomeView({ reviewChannelId: "C_REVIEW" }));

describe("the guide", () => {
  it("says to mute the channel, and why that is safe", async () => {
    // Forty products is forty messages. Without this the app is a nuisance
    // on day one — and the single @-mention is what makes muting safe.
    expect(text()).toContain("Mute");
    expect(text()).toContain("mentioned");
  });

  it("names the columns the CSV must have", async () => {
    for (const column of ["SKU", "Product Name", "Photo", "Shot Idea", "Notes"]) {
      expect(text()).toContain(column);
    }
  });

  it("explains what Photo and Shot Idea are for", async () => {
    expect(text()).toContain("without a login");
    expect(text()).toContain("you do not need to write a prompt");
  });

  it("warns that Notes are ignored, with the reason", async () => {
    // Somebody will otherwise put a real instruction in Notes and wonder why
    // it had no effect.
    expect(text()).toContain("Notes are ignored");
    expect(text()).toContain("If it needs to be in the shot");
  });

  it("says a blank Shot Idea costs nothing", async () => {
    expect(text()).toContain("nothing is invented");
  });

  it("walks from upload to zip in order", async () => {
    const guide = text();
    const steps = [
      "Set up the channel",
      "Get the ability to decide",
      "Build your catalog CSV",
      "Upload",
      "Review the photographs",
      "Confirm",
    ];
    let last = -1;
    for (const step of steps) {
      const at = guide.indexOf(step);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });

  it("points at the configured review channel when there is one", () => {
    expect(text()).toContain("<#C_REVIEW>");
    expect(JSON.stringify(buildHomeView())).toContain("your review channel");
  });

  it("stays inside Slack's block limit", () => {
    const view = buildHomeView({ reviewChannelId: "C_REVIEW" }) as { blocks: unknown[] };
    expect(view.blocks.length).toBeLessThanOrEqual(100);
  });
});

describe("the events endpoint", () => {
  it("proves it owns the URL", async () => {
    const res = await app().request(
      event({ type: "url_verification", challenge: "abc123" }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("abc123");
  });

  it("draws the guide when somebody opens the app", async () => {
    const res = await app().request(
      event({ type: "event_callback", event: { type: "app_home_opened", user: "U_MAYA" } }),
    );
    expect(res.status).toBe(200);

    await flush();
    expect(slack.homeViews).toHaveLength(1);
    expect(slack.homeViews[0]!.userId).toBe("U_MAYA");
    expect(JSON.stringify(slack.homeViews[0]!.view)).toContain("Build your catalog CSV");
  });

  it("acknowledges before drawing anything, so Slack does not retry", async () => {
    await app().request(
      event({ type: "event_callback", event: { type: "app_home_opened", user: "U_MAYA" } }),
    );
    expect(slack.homeViews).toHaveLength(0);
    expect(deferred).toHaveLength(1);
  });

  it("ignores events it did not ask for", async () => {
    await app().request(
      event({ type: "event_callback", event: { type: "message", user: "U_MAYA" } }),
    );
    await flush();
    expect(slack.homeViews).toHaveLength(0);
  });

  it("refuses an unsigned request", async () => {
    const res = await app().request(
      new Request("http://localhost/slack/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "url_verification", challenge: "abc" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});
