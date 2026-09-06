import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { grantWriteAccess } from "../access/store.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { buildBrandContext, buildSystemPrompt, DEFAULT_DIRECTION } from "../generation/brand.js";
import { createApp } from "../slack/app.js";
import { createFakeSlack, type FakeSlack } from "../slack/testing.js";
import { PROMPT_ACTION_ID, PROMPT_BLOCK_ID, PROMPT_CALLBACK_ID } from "./modal.js";
import { getPromptDirection, MAX_DIRECTION_LENGTH, savePromptDirection } from "./prompt.js";

const SECRET = "test-signing-secret";
const NOW = 1_700_000_000_000;
const ELLIE = "U_ELLIE";

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
    approverUserId: ELLIE,
  });
}

async function flush() {
  for (const task of deferred.splice(0)) await task();
}

function sign(body: string) {
  const ts = Math.floor(NOW / 1000);
  const digest = createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");
  return {
    "content-type": "application/x-www-form-urlencoded",
    "x-slack-request-timestamp": String(ts),
    "x-slack-signature": `v0=${digest}`,
  };
}

function command(text: string, userId = ELLIE) {
  const body = new URLSearchParams({
    command: "/luma",
    text,
    user_id: userId,
    channel_id: "C_REVIEW",
    trigger_id: "trigger-123",
  }).toString();
  return new Request("http://localhost/slack/commands", {
    method: "POST",
    headers: sign(body),
    body,
  });
}

function submission(value: string, userId = ELLIE) {
  const payload = {
    type: "view_submission",
    user: { id: userId },
    view: {
      callback_id: PROMPT_CALLBACK_ID,
      state: {
        values: { [PROMPT_BLOCK_ID]: { [PROMPT_ACTION_ID]: { value } } },
      },
    },
  };
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  return new Request("http://localhost/slack/interactions", {
    method: "POST",
    headers: sign(body),
    body,
  });
}

const rows = [
  {
    sku: "HG-002",
    productName: "Mug",
    category: "Ceramics",
    colour: "Sage",
    material: "Stoneware",
    price: "$28",
    photoUrl: "https://example.com/a.jpg",
    shotIdea: "morning kitchen counter",
    slot: 0,
    permalink: null,
    messageTs: null,
  },
];

describe("the direction, stored", () => {
  it("is the built-in when nothing has been saved", async () => {
    const current = await getPromptDirection(db);
    expect(current.isOverride).toBe(false);
    expect(current.text).toBe(DEFAULT_DIRECTION);
  });

  it("remembers an override and who wrote it", async () => {
    await savePromptDirection(db, { text: "Be terse.", byUserId: ELLIE });

    const current = await getPromptDirection(db);
    expect(current.text).toBe("Be terse.");
    expect(current.isOverride).toBe(true);
    expect(current.updatedBy).toBe(ELLIE);
  });

  it("treats a blank box as reverting", async () => {
    // The same gesture as clearing a field, so getting back to the built-in
    // does not depend on remembering what it said.
    await savePromptDirection(db, { text: "Be terse.", byUserId: ELLIE });
    const outcome = await savePromptDirection(db, { text: "   ", byUserId: ELLIE });

    expect(outcome).toEqual({ ok: true, reverted: true });
    expect((await getPromptDirection(db)).isOverride).toBe(false);
  });

  it("does not copy the built-in into the row", async () => {
    // Storing a snapshot at first open would mean improving the built-in
    // silently failed to reach anyone who had ever looked at it.
    await savePromptDirection(db, { text: "x", byUserId: ELLIE });
    await savePromptDirection(db, { text: "", byUserId: ELLIE });

    const { rows: stored } = await db.query(`select * from settings`);
    expect(stored).toHaveLength(0);
  });

  it("refuses one long enough to cost real money per product", async () => {
    const outcome = await savePromptDirection(db, {
      text: "x".repeat(MAX_DIRECTION_LENGTH + 1),
      byUserId: ELLIE,
    });

    expect(outcome.ok).toBe(false);
    expect((await getPromptDirection(db)).isOverride).toBe(false);
  });
});

describe("what the override can and cannot replace", () => {
  it("replaces the direction", () => {
    const brand = buildBrandContext(rows);
    const prompt = buildSystemPrompt(brand, "Only ever write one sentence.");

    expect(prompt).toContain("Only ever write one sentence.");
    expect(prompt).not.toContain("YOUR JOB");
  });

  it("never replaces the brand block read from the catalog", () => {
    // The palette and the team's own phrasing come from the file, and an
    // override that dropped them would quietly undo the thing that makes the
    // shots look like this brand.
    const brand = buildBrandContext(rows);
    const prompt = buildSystemPrompt(brand, "Only ever write one sentence.");

    expect(prompt).toContain("sage");
    expect(prompt).toContain("stoneware");
    expect(prompt).toContain("morning kitchen counter");
  });
});

describe("/luma system-prompt", () => {
  it("opens a modal prefilled with what is actually being sent", async () => {
    await app().request(command("system-prompt"));

    const view = JSON.stringify(slack.views[0]!.view);
    expect(slack.views[0]!.view.callback_id).toBe(PROMPT_CALLBACK_ID);
    expect(view).toContain("YOUR JOB");
    expect(view).toContain("built-in wording");
  });

  it("says the brand half is not editable, and why", async () => {
    await app().request(command("system-prompt"));
    const view = JSON.stringify(slack.views[0]!.view);

    expect(view).toContain("read from");
    expect(view).toContain("catalog");
  });

  it("refuses someone who cannot approve photos", async () => {
    const res = await app().request(command("system-prompt", "U_STRANGER"));
    const body = (await res.json()) as { text: string };

    expect(body.text).toContain("Only people who can approve");
    expect(slack.views).toHaveLength(0);
  });

  it("lets anyone on the access list open it", async () => {
    await grantWriteAccess(db, "U_MAYA", ELLIE);
    await app().request(command("system-prompt", "U_MAYA"));
    expect(slack.views).toHaveLength(1);
  });

  it("is in the glossary", async () => {
    const res = await app().request(command("nonsense"));
    const body = (await res.json()) as { text: string };
    expect(body.text).toContain("/luma system-prompt");
  });
});

describe("saving it", () => {
  it("stores the new wording and tells the channel", async () => {
    const res = await app().request(submission("Write only at golden hour."));
    expect(res.status).toBe(200);

    expect((await getPromptDirection(db)).text).toBe("Write only at golden hour.");

    await flush();
    expect(slack.posts[0]!.text).toContain("changed the system prompt");
    expect(slack.posts[0]!.text).toContain(`<@${ELLIE}>`);
    // Nobody should think this re-makes what has already been paid for.
    expect(slack.posts[0]!.text).toContain("next");
  });

  it("says so when it was a revert", async () => {
    await savePromptDirection(db, { text: "Be terse.", byUserId: ELLIE });
    await app().request(submission(""));
    await flush();

    expect(slack.posts[0]!.text).toContain("reverted");
    expect((await getPromptDirection(db)).isOverride).toBe(false);
  });

  it("returns the refusal into the field, not into the channel", async () => {
    const res = await app().request(submission("x".repeat(MAX_DIRECTION_LENGTH + 1)));
    const body = (await res.json()) as {
      response_action: string;
      errors: Record<string, string>;
    };

    expect(body.response_action).toBe("errors");
    expect(body.errors[PROMPT_BLOCK_ID]).toContain("limit");
    await flush();
    expect(slack.posts).toHaveLength(0);
  });

  it("re-checks access on submit, because the view outlives the permission", async () => {
    const res = await app().request(submission("Anything.", "U_STRANGER"));
    const body = (await res.json()) as {
      response_action: string;
      errors: Record<string, string>;
    };

    expect(body.response_action).toBe("errors");
    expect(body.errors[PROMPT_BLOCK_ID]).toContain("no longer have access");
    expect((await getPromptDirection(db)).isOverride).toBe(false);
  });
});
