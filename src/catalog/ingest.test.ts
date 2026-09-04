import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBatchRows, getLatestBatch } from "../db/repository.js";
import type { ImageGenerator } from "../generation/generator.js";
import { tick } from "../generation/loop.js";
import { createMemoryStore, type MemoryStore } from "../storage/memory.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createApp } from "../slack/app.js";
import { createFakeSlack, type FakeSlack } from "../slack/testing.js";
import { GENERATE_ACTION_ID, UPLOAD_CALLBACK_ID } from "./ingest.js";

const SECRET = "test-signing-secret";
const NOW = 1_700_000_000_000;
const FILE_URL = "https://files.slack.com/files-pri/T1-F1/catalog.csv";
const REAL_CATALOG = readFileSync("data/catalog.csv", "utf8");

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
  });
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

  it("closes the modal immediately and works afterwards", async () => {
    const res = await app().request(viewSubmission());
    expect(res.status).toBe(200);
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

  it("posts a recap carrying the counts and the bill", async () => {
    await app().request(viewSubmission());
    await drain();

    const [recap] = slack.posts;
    expect(recap!.channel).toBe("C_REVIEW");
    expect(recap!.text).toContain("40");
    expect(recap!.text).toContain("16");
    expect(recap!.text).toMatch(/\$5\.\d\d/);
  });

  it("puts a Generate button on the recap", async () => {
    await app().request(viewSubmission());
    await drain();
    expect(JSON.stringify(slack.posts[0]!.blocks)).toContain(GENERATE_ACTION_ID);
  });

  it("spends nothing", async () => {
    await app().request(viewSubmission());
    await drain();
    expect(slack.uploads).toHaveLength(0);
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

    expect(slack.posts[0]!.text).toContain("Photo");
    expect(await getLatestBatch(db)).toBeNull();
  });

  it("says so when the file cannot be downloaded at all", async () => {
    // No fake file registered — stands in for a revoked token or lost scope.
    await app().request(viewSubmission("https://files.slack.com/missing"));
    await drain();
    expect(slack.posts[0]!.text).toContain("couldn't read");
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
    expect(slack.posts[0]!.text).toContain("Photo");
    expect(slack.posts[0]!.text).toContain("HG-001");
  });
});

describe("the Generate button", () => {
  async function uploadThenPressGenerate() {
    slack.files.set(FILE_URL, REAL_CATALOG);
    await app().request(viewSubmission());
    await drain();

    const batch = await getLatestBatch(db);
    slack.posts.length = 0;

    const payload = {
      type: "block_actions",
      user: { id: "U_ELLIE" },
      channel: { id: "C_REVIEW" },
      message: { ts: "1700000000.000100" },
      actions: [{ action_id: GENERATE_ACTION_ID, value: String(batch!.id) }],
    };
    const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const res = await app().request(
      new Request("http://localhost/slack/interactions", {
        method: "POST",
        headers: sign(body),
        body,
      }),
    );
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

  it("acknowledges before starting any work", async () => {
    const { res } = await uploadThenPressGenerate();
    expect(res.status).toBe(200);
    expect(slack.posts).toHaveLength(0);
    expect(slack.uploads).toHaveLength(0);
  });

  it("announces the run in the team's terms before doing it", async () => {
    await uploadThenPressGenerate();
    await drain();

    const announcement = slack.posts[0]!.text;
    expect(announcement).toContain("*48* styled photos");
    expect(announcement).toContain("*24* original photos");
    // Announced immediately; nothing generated yet.
    expect(slack.uploads).toHaveLength(0);
  });

  it("sets the expectation that photos take time and arrive in sets", async () => {
    // Without this, silence after pressing Generate reads as a broken system.
    await uploadThenPressGenerate();
    await drain();

    const announcement = slack.posts[0]!.text;
    expect(announcement).toContain("Nothing will appear straight away");
    expect(announcement).toContain("product by product");
    expect(announcement).toMatch(/about \d+ minutes/);
    expect(announcement).toContain("I'll mention you");
  });

  it("runs the whole catalog through and posts every image", async () => {
    await generateAndRunWorker();

    // 16 shot ideas at 3 candidates each, plus 24 originals passed through.
    expect(slack.uploads).toHaveLength(72);
    expect(store.objects.size).toBe(72);
  });

  it("mentions the approver exactly once, at the end", async () => {
    // One ping per batch, not one per image — the whole notification design
    // depends on the stream itself posting quietly.
    await generateAndRunWorker();

    const mentions = slack.posts.filter((p) => p.text.includes("<@U_ELLIE>"));
    expect(mentions).toHaveLength(1);
    expect(slack.posts.at(-1)!.text).toContain("Approve or a Discard");
  });

  it("charges nothing for the products with no shot idea", async () => {
    await generateAndRunWorker();

    const originals = slack.uploads.filter((u) => u.filename.endsWith("_original.jpg"));
    expect(originals).toHaveLength(24);
  });
});
