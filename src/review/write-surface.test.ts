import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMagicLink, grantWriteAccess, redeemMagicLink, revokeWriteAccess } from "../access/store.js";
import {
  addBatchRows,
  createBatch,
  ensureReviewToken,
  getDeliveredBatchId,
  getProductImages,
} from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { startGeneration } from "../generation/start.js";
import { drain } from "../generation/worker.js";
import { createApp } from "../slack/app.js";
import { createFakeSlack, type FakeSlack } from "../slack/testing.js";
import { createMemoryStore, type MemoryStore } from "../storage/memory.js";

const ELLIE = "U_ELLIE";
const NOW = 1_700_000_000_000;

let db: TestDb;
let slack: FakeSlack;
let store: MemoryStore;
let deferred: Array<() => Promise<void>>;

beforeEach(async () => {
  db = await createTestDb();
  slack = createFakeSlack();
  store = createMemoryStore();
  deferred = [];
});
afterEach(async () => {
  await db?.close();
});

const fetchOk = (async () =>
  new Response(Buffer.from("jpeg"), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  })) as unknown as typeof fetch;

function app() {
  return createApp({
    signingSecret: "s",
    now: () => NOW,
    defer: (task) => {
      deferred.push(task);
    },
    db,
    slack,
    store,
    reviewChannelId: "C_REVIEW",
    approverUserId: ELLIE,
    publicBaseUrl: "https://shots.test",
  });
}

async function flush() {
  for (const task of deferred.splice(0)) await task();
}

/** A batch with its photographs made, and the token that opens its page. */
async function reviewable(skus = ["HG-002"]) {
  const batch = await createBatch(db, { sourceFilename: "catalog.csv" });
  await addBatchRows(
    db,
    batch.id,
    skus.map((sku) => ({
      sku,
      productName: `Product ${sku}`,
      category: "Ceramics",
      colour: "Sage",
      material: "Stoneware",
      price: "$28",
      photoUrl: "https://example.com/a.jpg",
      shotIdea: "kitchen counter",
    })),
  );
  await startGeneration(db, batch.id);
  await drain(
    {
      db,
      generator: {
        submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
        poll: async () => ({ state: "completed" as const, outputUrl: "https://luma/o.jpg" }),
      },
      store,
      slack,
      channel: "C_REVIEW",
      model: "uni-1-max",
      aspectRatio: "1:1",
      fetch: fetchOk,
      sleep: async () => {},
    },
    { batchId: batch.id },
  );

  const token = await ensureReviewToken(db, batch.id);
  const { images } = await getProductImages(db, batch.id, skus[0]!);
  return { batch, token, imageIds: images.map((i) => i.imageId) };
}

/** Signs someone in the way `/luma signin` does, and returns their cookie. */
async function signIn(userId: string) {
  const link = await createMagicLink(db, userId, NOW);
  const session = await redeemMagicLink(db, link, NOW);
  return `luma_session=${session!.id}`;
}

const post = (
  token: string,
  path: string,
  body: unknown,
  cookie?: string,
) =>
  app().request(`/api/review/${token}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

describe("deciding from the page", () => {
  it("refuses a reader who is not signed in", async () => {
    const { batch, token, imageIds } = await reviewable();

    const res = await post(token, "decide", {
      imageId: imageIds[0],
      decision: "approve",
    });

    expect(res.status).toBe(403);
    // Knowing the link is enough to look; it is not enough to act.
    const { images } = await getProductImages(db, batch.id, "HG-002");
    expect(images.every((i) => (i.decision ?? null) === null)).toBe(true);
  });

  it("lets a signed-in approver decide", async () => {
    const { batch, token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);

    const res = await post(
      token,
      "decide",
      { imageId: imageIds[0], decision: "approve" },
      cookie,
    );

    expect(res.status).toBe(200);
    const { images } = await getProductImages(db, batch.id, "HG-002");
    expect(images.find((i) => i.imageId === imageIds[0])!.decision).toBe("approved");
  });

  it("lets someone the approver has granted access decide", async () => {
    const { batch, token, imageIds } = await reviewable();
    await grantWriteAccess(db, "U_MAYA", ELLIE);
    const cookie = await signIn("U_MAYA");

    expect(
      (await post(token, "decide", { imageId: imageIds[0], decision: "discard" }, cookie))
        .status,
    ).toBe(200);
    const { images } = await getProductImages(db, batch.id, "HG-002");
    expect(images.find((i) => i.imageId === imageIds[0])!.decision).toBe("discarded");
  });

  it("stops accepting writes from a session whose access was revoked", async () => {
    // Access is checked on every write, not once at sign-in — otherwise
    // revoking someone would take up to a day to take effect.
    const { token, imageIds } = await reviewable();
    await grantWriteAccess(db, "U_MAYA", ELLIE);
    const cookie = await signIn("U_MAYA");
    await revokeWriteAccess(db, "U_MAYA");

    const res = await post(
      token,
      "decide",
      { imageId: imageIds[0], decision: "approve" },
      cookie,
    );
    expect(res.status).toBe(403);
  });

  it("rejects a body that names no image or no decision", async () => {
    const { token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);

    expect((await post(token, "decide", { decision: "approve" }, cookie)).status).toBe(400);
    expect(
      (await post(token, "decide", { imageId: imageIds[0], decision: "maybe" }, cookie))
        .status,
    ).toBe(400);
  });

  it("is not found for a token that opens nothing", async () => {
    const cookie = await signIn(ELLIE);
    expect((await post("nope", "decide", { imageId: "x", decision: "approve" }, cookie)).status)
      .toBe(404);
  });
});

describe("confirming from the page", () => {
  async function decideAll(token: string, ids: string[], cookie: string) {
    for (const imageId of ids) {
      await post(token, "decide", { imageId, decision: "approve" }, cookie);
    }
  }

  it("refuses a reader who is not signed in", async () => {
    const { token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);
    await decideAll(token, imageIds, cookie);

    expect((await post(token, "confirm", {})).status).toBe(403);
    expect(await getDeliveredBatchId(db)).toBeNull();
  });

  it("refuses while anything is still undecided", async () => {
    const { token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);
    await post(token, "decide", { imageId: imageIds[0], decision: "approve" }, cookie);

    expect((await post(token, "confirm", {}, cookie)).status).toBe(409);
    expect(await getDeliveredBatchId(db)).toBeNull();
  });

  it("hands the batch over once everything is decided", async () => {
    const { batch, token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);
    await decideAll(token, imageIds, cookie);

    expect((await post(token, "confirm", {}, cookie)).status).toBe(200);
    expect(await getDeliveredBatchId(db)).toBe(batch.id);

    await flush();
    const said = slack.posts.map((p) => p.text).join("\n");
    expect(said).toContain("confirmed");
    expect(said).toContain(`<@${ELLIE}>`);
    expect(slack.uploads.some((u) => u.filename.endsWith(".csv"))).toBe(true);
  });

  it("cannot be confirmed twice", async () => {
    const { token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);
    await decideAll(token, imageIds, cookie);
    await post(token, "confirm", {}, cookie);

    expect((await post(token, "confirm", {}, cookie)).status).toBe(409);
  });
});

describe("the page itself", () => {
  it("shows controls to a writer and none to a reader", async () => {
    const { token } = await reviewable();
    const cookie = await signIn(ELLIE);

    const asReader = await app().request(`/review/${token}`);
    const asWriter = await app().request(`/review/${token}`, { headers: { cookie } });

    expect(await asReader.text()).not.toContain('class="acts"');
    expect(await asWriter.text()).toContain('class="acts"');
  });

  it("anchors each product so a Slack link lands on the right one", async () => {
    const { token } = await reviewable(["HG-002", "HG-003"]);
    const html = await (await app().request(`/review/${token}`)).text();

    expect(html).toContain('id="p-HG-002"');
    expect(html).toContain('id="p-HG-003"');
  });

  it("makes the handover take two taps", async () => {
    // It cannot be undone, and it sits on the same page as every approve
    // and discard button.
    const { token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);
    for (const imageId of imageIds) {
      await post(token, "decide", { imageId, decision: "approve" }, cookie);
    }

    const html = await (
      await app().request(`/review/${token}`, { headers: { cookie } })
    ).text();
    expect(html).toContain("Tap again to freeze this batch");
    expect(html).toContain("can't be changed");
  });

  it("keeps watching for other people's decisions once generation is done", async () => {
    // Write access is a list, so two people can be deciding at once.
    const { token } = await reviewable();
    const html = await (await app().request(`/review/${token}`)).text();
    expect(html).toContain("setInterval(refresh");
  });

  it("links each product back to the Slack thread it was posted in", async () => {
    const { token } = await reviewable();
    const html = await (await app().request(`/review/${token}`)).text();

    // The fake mints permalinks from the channel, so any link into it proves
    // the round trip: post → capture → store → render.
    expect(html).toContain("https://example.slack.com/archives/C_REVIEW/");
  });
});
