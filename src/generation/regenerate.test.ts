import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMagicLink, redeemMagicLink } from "../access/store.js";
import {
  addBatchRows,
  createBatch,
  ensureReviewToken,
  getProductImages,
  recordDecision,
  setBatchState,
  setDeliveredBatch,
} from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { buildReviewState } from "../review/state.js";
import { renderReviewPage } from "../review/page.js";
import { createApp } from "../slack/app.js";
import { createFakeSlack, type FakeSlack } from "../slack/testing.js";
import { createMemoryStore, type MemoryStore } from "../storage/memory.js";
import { regenerate } from "./regenerate.js";
import { startGeneration } from "./start.js";
import { drain } from "./worker.js";

const ELLIE = "U_ELLIE";
const NOW = 1_700_000_000_000;

let db: TestDb;
let slack: FakeSlack;
let store: MemoryStore;

beforeEach(async () => {
  db = await createTestDb();
  slack = createFakeSlack();
  store = createMemoryStore();
});
afterEach(async () => {
  await db?.close();
});

const fetchOk = (async () =>
  new Response(Buffer.from("jpeg"), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  })) as unknown as typeof fetch;

const generator = {
  submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
  poll: async () => ({ state: "completed" as const, outputUrl: "https://luma/o.jpg" }),
};

function workerDeps() {
  return {
    db,
    generator,
    store,
    slack,
    channel: "C_REVIEW",
    model: "uni-1-max" as const,
    aspectRatio: "1:1",
    fetch: fetchOk,
    sleep: async () => {},
  };
}

function app() {
  return createApp({
    signingSecret: "s",
    now: () => NOW,
    defer: () => {},
    db,
    slack,
    store,
    reviewChannelId: "C_REVIEW",
    approverUserId: ELLIE,
    publicBaseUrl: "https://shots.test",
  });
}

async function signIn(userId = ELLIE) {
  const link = await createMagicLink(db, userId, NOW);
  const session = await redeemMagicLink(db, link, NOW);
  return `luma_session=${session!.id}`;
}

/** A batch seeded and, unless told otherwise, run to the point of posting. */
async function seeded({ post = true } = {}) {
  const batch = await createBatch(db, { sourceFilename: "catalog.csv" });
  await addBatchRows(db, batch.id, [
    {
      sku: "HG-002",
      productName: "Stoneware Mug",
      category: "Ceramics",
      colour: "Sage",
      material: "Stoneware",
      price: "$28",
      photoUrl: "https://example.com/a.jpg",
      shotIdea: "morning kitchen counter",
    },
  ]);
  await startGeneration(db, batch.id);
  if (post) await drain(workerDeps(), { batchId: batch.id });

  const token = await ensureReviewToken(db, batch.id);
  const { images } = await getProductImages(db, batch.id, "HG-002");
  return { batch, token, images };
}

describe("asking for another shot", () => {
  it("waits for the product's thread to exist", async () => {
    // The new photo is posted into that thread. Generating it first would
    // leave it with nowhere to go.
    const { images } = await seeded({ post: false });

    const outcome = await regenerate({
      db,
      imageId: images[0]!.imageId,
      prompt: "Same mug, lower light.",
    });

    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { reason: string }).reason).toContain("haven't been posted");
  });

  it("adds one shot, not three", async () => {
    // The batch makes three because nobody has said what they want. Here
    // somebody has, so two of them would be bought to be ignored.
    const { batch, images } = await seeded();
    const before = images.length;

    await regenerate({ db, imageId: images[0]!.imageId, prompt: "Lower light." });

    const { images: after } = await getProductImages(db, batch.id, "HG-002");
    expect(after).toHaveLength(before + 1);
  });

  it("uses the words as written", async () => {
    const { batch, images } = await seeded();
    await regenerate({
      db,
      imageId: images[0]!.imageId,
      prompt: "The mug on a windowsill, rain outside.",
    });

    const { images: after } = await getProductImages(db, batch.id, "HG-002");
    expect(after.at(-1)!.prompt).toBe("The mug on a windowsill, rain outside.");
  });

  it("appends rather than replacing, leaving decisions alone", async () => {
    // A regeneration is a new opinion about a shot, not a correction of the
    // record — the same rule that keeps an approved photo identical forever.
    const { batch, images } = await seeded();
    await recordDecision(db, {
      imageId: images[0]!.imageId,
      decision: "approve",
      actor: ELLIE,
    });

    await regenerate({ db, imageId: images[0]!.imageId, prompt: "Lower light." });

    const { images: after } = await getProductImages(db, batch.id, "HG-002");
    const original = after.find((i) => i.imageId === images[0]!.imageId)!;
    expect(original.decision).toBe("approved");
    expect(original.filename).toBe(images[0]!.filename);
    expect(after.at(-1)!.slot).toBe(images.length + 1);
  });

  it("refuses once the batch has been handed over", async () => {
    const { batch, images } = await seeded();
    for (const image of images) {
      await recordDecision(db, {
        imageId: image.imageId,
        decision: "approve",
        actor: ELLIE,
      });
    }
    await setDeliveredBatch(db, batch.id);
    await setBatchState(db, batch.id, "delivered");

    const outcome = await regenerate({
      db,
      imageId: images[0]!.imageId,
      prompt: "Lower light.",
    });
    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { reason: string }).reason).toContain("handed over");
  });

  it("refuses an empty prompt, because nothing writes it for you", async () => {
    const { images } = await seeded();
    const outcome = await regenerate({ db, imageId: images[0]!.imageId, prompt: "  " });
    expect(outcome).toMatchObject({ ok: false });
  });
});

describe("where the new shot goes", () => {
  it("joins the product's existing thread instead of starting another", async () => {
    const { batch, images } = await seeded();
    const linesBefore = slack.posts.filter((p) => p.text.includes("HG-002")).length;
    const threadTs = slack.uploads[0]!.threadTs;

    await regenerate({ db, imageId: images[0]!.imageId, prompt: "Lower light." });
    await drain(workerDeps(), { batchId: batch.id });

    const linesAfter = slack.posts.filter((p) => p.text.includes("HG-002")).length;
    expect(linesAfter).toBe(linesBefore);
    expect(slack.uploads.at(-1)!.threadTs).toBe(threadTs);
  });

  it("redraws the product's line so its counts stay true", async () => {
    const { batch, images } = await seeded();
    await regenerate({ db, imageId: images[0]!.imageId, prompt: "Lower light." });
    await drain(workerDeps(), { batchId: batch.id });

    expect(slack.updates.some((u) => u.text.includes("HG-002"))).toBe(true);
  });

  it("does not re-upload the shots that were already posted", async () => {
    const { batch, images } = await seeded();
    const uploadsBefore = slack.uploads.length;

    await regenerate({ db, imageId: images[0]!.imageId, prompt: "Lower light." });
    await drain(workerDeps(), { batchId: batch.id });

    expect(slack.uploads).toHaveLength(uploadsBefore + 1);
  });
});

describe("the endpoint", () => {
  const post = (token: string, body: unknown, cookie?: string) =>
    app().request(`/api/review/${token}/regenerate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });

  it("refuses a reader who is not signed in", async () => {
    const { batch, token, images } = await seeded();
    const res = await post(token, { imageId: images[0]!.imageId, prompt: "x" });

    expect(res.status).toBe(403);
    const { images: after } = await getProductImages(db, batch.id, "HG-002");
    expect(after).toHaveLength(images.length);
  });

  it("accepts one from a signed-in writer", async () => {
    const { batch, token, images } = await seeded();
    const cookie = await signIn();

    const res = await post(
      token,
      { imageId: images[0]!.imageId, prompt: "Lower light." },
      cookie,
    );

    expect(res.status).toBe(200);
    const { images: after } = await getProductImages(db, batch.id, "HG-002");
    expect(after).toHaveLength(images.length + 1);
  });

  it("passes a refusal back with its reason", async () => {
    const { token, images } = await seeded({ post: false });
    const cookie = await signIn();

    const res = await post(token, { imageId: images[0]!.imageId, prompt: "x" }, cookie);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toContain("posted");
  });
});

describe("after a reshoot, the batch can still be closed out", () => {
  it("stops being confirmable until the new shot is decided, then confirms", async () => {
    // Reaching "everything decided" and then asking for one more must not
    // strand the batch: the new photo joins the set that has to be settled.
    const { batch, token, images } = await seeded();
    const cookie = await signIn();

    const decide = (imageId: string) =>
      app().request(`/api/review/${token}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ imageId, decision: "approve" }),
      });
    const confirm = () =>
      app().request(`/api/review/${token}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: "{}",
      });

    for (const image of images) await decide(image.imageId);

    await regenerate({ db, imageId: images[0]!.imageId, prompt: "Lower light." });
    expect((await confirm()).status).toBe(409);

    await drain(workerDeps(), { batchId: batch.id });
    const { images: after } = await getProductImages(db, batch.id, "HG-002");
    await decide(after.at(-1)!.imageId);

    expect((await confirm()).status).toBe(200);
  });
});

describe("the control on the page", () => {
  it("is absent until the product has a thread", async () => {
    const { token } = await seeded({ post: false });
    const html = renderReviewPage((await buildReviewState(db, token))!, token, {
      canWrite: true,
    });
    expect(html).not.toContain("Ask for another");
  });

  it("appears once it does, prefilled with the prompt it came from", async () => {
    const { token } = await seeded();
    const html = renderReviewPage((await buildReviewState(db, token))!, token, {
      canWrite: true,
    });

    expect(html).toContain("Ask for another");
    expect(html).toContain("morning kitchen counter");
    expect(html).toContain("nothing rewrites it");
  });

  it("is offered on a product that never had a shot idea", async () => {
    // Having no idea written down is the most likely reason to want one.
    const batch = await createBatch(db, { sourceFilename: "catalog.csv" });
    await addBatchRows(db, batch.id, [
      {
        sku: "HG-003",
        productName: "Linen Napkin",
        category: "Textiles",
        colour: "Sage",
        material: "Linen",
        price: "$18",
        photoUrl: "https://example.com/a.jpg",
        shotIdea: null,
      },
    ]);
    await startGeneration(db, batch.id);
    await drain(workerDeps(), { batchId: batch.id });
    const token = await ensureReviewToken(db, batch.id);

    const html = renderReviewPage((await buildReviewState(db, token))!, token, {
      canWrite: true,
    });
    expect(html).toContain("Ask for another");
  });

  it("accepts one for a product with no shot idea", async () => {
    const batch = await createBatch(db, { sourceFilename: "catalog.csv" });
    await addBatchRows(db, batch.id, [
      {
        sku: "HG-003",
        productName: "Linen Napkin",
        category: "Textiles",
        colour: "Sage",
        material: "Linen",
        price: "$18",
        photoUrl: "https://example.com/a.jpg",
        shotIdea: null,
      },
    ]);
    await startGeneration(db, batch.id);
    await drain(workerDeps(), { batchId: batch.id });

    const { images } = await getProductImages(db, batch.id, "HG-003");
    const outcome = await regenerate({
      db,
      imageId: images[0]!.imageId,
      prompt: "Folded on a sunlit table.",
    });

    expect(outcome).toMatchObject({ ok: true });
    const { images: after } = await getProductImages(db, batch.id, "HG-003");
    expect(after).toHaveLength(2);
    expect(after.at(-1)!.kind).toBe("styled");
  });

  it("is not offered to a reader who cannot act", async () => {
    const { token } = await seeded();
    const html = renderReviewPage((await buildReviewState(db, token))!, token);
    expect(html).not.toContain("Ask for another");
  });
});
