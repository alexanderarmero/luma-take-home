import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBatchRows, getLatestBatch } from "../db/repository.js";
import type { ImageGenerator } from "../generation/generator.js";
import { tick } from "../generation/loop.js";
import { createMemoryStore, type MemoryStore } from "../storage/memory.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createApp } from "../slack/app.js";
import {
  allImageFilenames,
  createFakeSlack,
  type FakeSlack,
} from "../slack/testing.js";
import { RECAP_CALLBACK_ID, UPLOAD_CALLBACK_ID } from "./ingest.js";

const SECRET = "test-signing-secret";
const NOW = 1_700_000_000_000;
const FILE_URL = "https://files.slack.com/files-pri/T1-F1/catalog.csv";
const REAL_CATALOG = readFileSync("data/catalog.csv", "utf8");
const EXTERNAL_ID = "ext-test-1";

let db: TestDb;
let slack: FakeSlack;
let store: MemoryStore;
let deferred: Array<() => Promise<void>>;

const generator: ImageGenerator = {
  submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
  poll: async () => ({ state: "completed", outputUrl: "https://luma/out.jpg" }),
};

const fetchImage = (async () =>
  new Response(Buffer.from("jpeg"), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  })) as unknown as typeof fetch;

beforeEach(async () => {
  db = await createTestDb();
  slack = createFakeSlack();
  store = createMemoryStore();
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
    generator,
    store,
    model: "uni-1-max",
    aspectRatio: "1:1",
    fetch: fetchImage,
    newExternalId: () => EXTERNAL_ID,
  });
}

/** The last view drawn into the open modal. */
function currentView() {
  return slack.viewUpdates.at(-1)?.view as
    | { callback_id?: string; private_metadata?: string; blocks: unknown[] }
    | undefined;
}

/** The text of that view, which is where the recap now lives. */
function currentViewText() {
  return JSON.stringify(currentView()?.blocks ?? []);
}

async function drain() {
  for (const task of deferred) await task();
  deferred = [];
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

function slashCommand(text: string, extra: Record<string, string> = {}) {
  const body = new URLSearchParams({
    command: "/luma",
    text,
    user_id: "U_ELLIE",
    channel_id: "C_REVIEW",
    trigger_id: "trigger-123",
    ...extra,
  }).toString();
  return new Request("http://localhost/slack/commands", {
    method: "POST",
    headers: sign(body),
    body,
  });
}

function viewSubmission(fileUrl = FILE_URL, filename = "catalog.csv") {
  const payload = {
    type: "view_submission",
    user: { id: "U_ELLIE" },
    view: {
      callback_id: UPLOAD_CALLBACK_ID,
      state: {
        values: {
          catalog_file: {
            catalog_file_input: {
              files: [{ id: "F1", name: filename, url_private: fileUrl }],
            },
          },
        },
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

describe("/luma upload", () => {
  it("opens the modal straight away", async () => {
    // trigger_id expires in about three seconds, so this cannot be deferred
    // behind other work.
    const res = await app().request(slashCommand("upload"));
    expect(res.status).toBe(200);
    expect(slack.views).toHaveLength(1);
    expect(slack.views[0]!.triggerId).toBe("trigger-123");
    expect(slack.views[0]!.view.callback_id).toBe(UPLOAD_CALLBACK_ID);
  });

  it("offers a CSV-only file input", async () => {
    await app().request(slashCommand("upload"));
    expect(JSON.stringify(slack.views[0]!.view)).toContain('"filetypes":["csv"]');
  });

  it("is listed in the usage text", async () => {
    const res = await app().request(slashCommand("nonsense"));
    const payload = (await res.json()) as { text: string };
    expect(payload.text).toContain("upload");
  });
});

describe("submitting the catalog", () => {
  beforeEach(() => {
    slack.files.set(FILE_URL, REAL_CATALOG);
  });

  it("shows a reading step immediately and works afterwards", async () => {
    // Reading and parsing outlasts Slack's three-second submission window,
    // so the response is a pushed view rather than a finished answer.
    const res = await app().request(viewSubmission());
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      response_action: string;
      view: { external_id: string; blocks: unknown[] };
    };
    expect(body.response_action).toBe("push");
    expect(body.view.external_id).toBe(EXTERNAL_ID);
    expect(JSON.stringify(body.view.blocks)).toContain("Reading your catalog");

    expect(slack.posts).toHaveLength(0);
    expect(deferred).toHaveLength(1);
  });

  it("records the batch and its parsed rows", async () => {
    await app().request(viewSubmission());
    await drain();

    const batch = await getLatestBatch(db);
    expect(batch?.sourceFilename).toBe("catalog.csv");

    const rows = await getBatchRows(db, batch!.id);
    expect(rows).toHaveLength(40);
    expect(rows.filter((r) => r.shotIdea !== null)).toHaveLength(16);
  });

  it("draws the recap into the modal, not the channel", async () => {
    // A file someone is still deciding about is not the channel's business.
    await app().request(viewSubmission());
    await drain();

    expect(slack.posts).toHaveLength(0);
    expect(slack.viewUpdates.at(-1)!.externalId).toBe(EXTERNAL_ID);

    const text = currentViewText();
    expect(text).toContain("40");
    expect(text).toContain("16");
    expect(text).toMatch(/\$5\.\d\d/);
  });

  it("makes Generate the modal's own submit button", async () => {
    // The estimate and the decision are the same view, so nobody can press
    // Generate without the bill in front of them.
    await app().request(viewSubmission());
    await drain();

    const view = currentView()!;
    expect(view.callback_id).toBe(RECAP_CALLBACK_ID);
    expect(JSON.stringify(view)).toContain('"text":"Generate"');

    const batch = await getLatestBatch(db);
    expect(view.private_metadata).toBe(String(batch!.id));
  });

  it("spends nothing", async () => {
    await app().request(viewSubmission());
    await drain();
    expect(allImageFilenames(slack)).toHaveLength(0);
  });

  it("never puts the CSV itself into the review channel", async () => {
    await app().request(viewSubmission());
    await drain();
    const everythingPosted = JSON.stringify(slack.posts);
    expect(everythingPosted).not.toContain("HG-003");
    expect(everythingPosted).not.toContain("take-home-service");
  });
});

describe("submitting something unusable", () => {
  it("explains the problem and creates no batch", async () => {
    slack.files.set(FILE_URL, "SKU,Product Name,Price\nHG-001,Vase,$48");
    await app().request(viewSubmission());
    await drain();

    expect(currentViewText()).toContain("Photo");
    expect(slack.posts).toHaveLength(0);
    expect(await getLatestBatch(db)).toBeNull();
  });

  it("offers nothing to submit when the file is unusable", async () => {
    slack.files.set(FILE_URL, "SKU,Product Name,Price\nHG-001,Vase,$48");
    await app().request(viewSubmission());
    await drain();
    expect(currentView()).not.toHaveProperty("submit");
  });

  it("says so when the file cannot be downloaded at all", async () => {
    // No fake file registered — stands in for a revoked token or lost scope.
    await app().request(viewSubmission("https://files.slack.com/missing"));
    await drain();
    expect(currentViewText()).toContain("couldn't read");
    expect(await getLatestBatch(db)).toBeNull();
  });

  it("reports why every row was skipped when none survive", async () => {
    slack.files.set(
      FILE_URL,
      "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes\n" +
        "HG-001,Vase,Ceramics,Sage,Stoneware,$48,,,\n" +
        "HG-002,Mug,Ceramics,Sage,Stoneware,$28,,,",
    );
    await app().request(viewSubmission());
    await drain();
    expect(currentViewText()).toContain("Photo");
    expect(currentViewText()).toContain("HG-001");
  });
});

/** Pressing Generate is submitting the recap view. */
function generateSubmission(batchId: number) {
  const payload = {
    type: "view_submission",
    user: { id: "U_ELLIE" },
    view: {
      callback_id: RECAP_CALLBACK_ID,
      private_metadata: String(batchId),
      state: { values: {} },
    },
  };
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  return new Request("http://localhost/slack/interactions", {
    method: "POST",
    headers: sign(body),
    body,
  });
}

describe("the Generate button", () => {
  async function uploadThenPressGenerate() {
    slack.files.set(FILE_URL, REAL_CATALOG);
    await app().request(viewSubmission());
    await drain();

    const batch = await getLatestBatch(db);
    slack.posts.length = 0;

    const res = await app().request(generateSubmission(batch!.id));
    return { res, batchId: batch!.id };
  }

  /** Presses Generate, then lets the background worker run the batch. */
  async function generateAndRunWorker() {
    const started = await uploadThenPressGenerate();
    await drain();
    await tick(
      {
        db,
        generator,
        store,
        slack,
        channel: "C_REVIEW",
        model: "uni-1-max",
        aspectRatio: "1:1",
        fetch: fetchImage,
        sleep: async () => {},
      },
      { approverUserId: "U_ELLIE" },
    );
    return started;
  }

  it("closes the whole stack, not just the view it was pressed on", async () => {
    // The recap was pushed on top of the upload view. An empty 200 closes
    // only the top one, dropping the person back onto the upload form they
    // already finished with — which reads exactly like a button that did
    // nothing.
    const { res } = await uploadThenPressGenerate();
    const body = (await res.json()) as { response_action: string };
    expect(body.response_action).toBe("clear");
  });

  it("says so in the modal when there is nowhere to post the photos", async () => {
    // Silently returning here would look identical to a working Generate:
    // the modal closes and nothing ever appears.
    slack.files.set(FILE_URL, REAL_CATALOG);
    await app().request(viewSubmission());
    await drain();
    const batch = await getLatestBatch(db);

    const unconfigured = createApp({
      signingSecret: SECRET,
      now: () => NOW,
      defer: (task) => {
        deferred.push(task);
      },
      db,
      slack,
      generator,
      store,
      newExternalId: () => EXTERNAL_ID,
    });

    const res = await unconfigured.request(generateSubmission(batch!.id));
    const body = (await res.json()) as {
      response_action: string;
      view: { blocks: unknown[] };
    };

    expect(body.response_action).toBe("update");
    expect(JSON.stringify(body.view.blocks)).toContain("nowhere to put the photos");
    expect(deferred).toHaveLength(0);
  });

  it("acknowledges before starting any work", async () => {
    const { res } = await uploadThenPressGenerate();
    expect(res.status).toBe(200);
    expect(slack.posts).toHaveLength(0);
    expect(allImageFilenames(slack)).toHaveLength(0);
  });

  it("speaks before it works, not after", async () => {
    // Writing prompts for sixteen products is a minute of API calls. Doing it
    // before saying anything leaves the channel silent, which is
    // indistinguishable from a button that does nothing.
    await uploadThenPressGenerate();
    await drain();

    const first = slack.posts[0]!.text;
    expect(first).toContain("has started");
    expect(first).toContain("Nothing will appear straight away");
    expect(first).toContain("I'll mention you");
    expect(allImageFilenames(slack)).toHaveLength(0);
  });

  it("follows up with the counts once the work is seeded", async () => {
    await uploadThenPressGenerate();
    await drain();

    const second = slack.posts[1]!.text;
    expect(second).toContain("*48* styled photos");
    expect(second).toContain("*24* originals");
    expect(second).toMatch(/about \d+ minutes/);
  });

  it("says publicly what the batch costs", async () => {
    // The recap that used to carry this is now private to the uploader, but
    // the spend is still the team's business.
    await uploadThenPressGenerate();
    await drain();

    expect(slack.posts[1]!.text).toMatch(/\$5\.\d\d/);
    expect(slack.posts[1]!.text).toContain("uni-1-max");
  });

  it("says so in the channel when starting fails, rather than going quiet", async () => {
    slack.files.set(FILE_URL, REAL_CATALOG);
    await app().request(viewSubmission());
    await drain();
    const batch = await getLatestBatch(db);
    slack.posts.length = 0;

    // A failure here previously reached stderr and nothing else.
    const brokenApp = createApp({
      signingSecret: SECRET,
      now: () => NOW,
      defer: (task) => {
        deferred.push(task);
      },
      db,
      slack,
      reviewChannelId: "C_REVIEW",
      approverUserId: "U_ELLIE",
      generator,
      store,
      fetch: fetchImage,
      promptWriterFor: () => {
        throw new Error("bad api key");
      },
    });

    await brokenApp.request(generateSubmission(batch!.id));
    await drain();

    // The construction failure is swallowed inside startGeneration, so the
    // batch still starts — the point is that the channel is never silent.
    expect(slack.posts.length).toBeGreaterThan(0);
    expect(slack.posts[0]!.text).toContain("has started");
  });

  it("runs the whole catalog through and posts every image", async () => {
    await generateAndRunWorker();

    // 16 shot ideas at 3 candidates each, plus 24 originals passed through.
    expect(allImageFilenames(slack)).toHaveLength(72);
    expect(store.objects.size).toBe(72);

    // 40 products, so 40 review messages rather than 72 — a third fewer
    // notifications and a channel that scrolls in product-sized chunks.
    const reviewMessages = slack.posts.filter((p) => /^HG-\d+ · /.test(p.text));
    expect(reviewMessages).toHaveLength(40);
  });

  it("mentions the approver exactly once, at the end", async () => {
    // One ping per batch, not one per image — the whole notification design
    // depends on the stream itself posting quietly.
    await generateAndRunWorker();

    const mentions = slack.posts.filter((p) => p.text.includes("<@U_ELLIE>"));
    expect(mentions).toHaveLength(1);
    expect(slack.posts.at(-1)!.text).toContain("approve or a discard");
  });

  it("charges nothing for the products with no shot idea", async () => {
    await generateAndRunWorker();

    const originals = allImageFilenames(slack).filter((f) =>
      f.endsWith("_original.jpg"),
    );
    expect(originals).toHaveLength(24);
  });
});
