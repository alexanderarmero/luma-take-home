import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMagicLink, grantWriteAccess, redeemMagicLink, revokeWriteAccess } from "../access/store.js";
import { buildReviewState } from "./state.js";
import { renderReviewPage } from "./page.js";
import {
  addBatchRows,
  createBatch,
  ensureReviewToken,
  getDeliveredBatchId,
  getProductImages,
  setIntroMessageTs,
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

/** The batch id named in whatever the bot said. */
function batchIdOf(text: string): number {
  return Number(text.match(/Batch #(\d+)/)![1]);
}

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

  it("leaves the batch's pin in place, so the pins read as a history", async () => {
    // Deliberate: a confirmed batch is still the batch someone may need to
    // find again, and the pinned list is the cheapest record of what ran.
    const { batch, token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);

    await setIntroMessageTs(db, batch.id, "1700000001.000100");
    slack.pinned.add("C_REVIEW:1700000001.000100");

    await decideAll(token, imageIds, cookie);
    expect((await post(token, "confirm", {}, cookie)).status).toBe(200);
    await flush();

    expect(slack.pinned.has("C_REVIEW:1700000001.000100")).toBe(true);
  });

  it("pins the confirmation, so the pins read as start and sign-off", async () => {
    const { token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);
    await decideAll(token, imageIds, cookie);

    await post(token, "confirm", {}, cookie);
    await flush();

    const confirmation = slack.posts.find((p) => p.text.includes("is confirmed"))!;
    expect(slack.pinned.has(`C_REVIEW:${confirmation.ts}`)).toBe(true);
  });

  it("still hands the batch over when pinning is refused", async () => {
    // pins:write may not be granted, and by the time this runs the handover
    // has already happened.
    slack.pinMessage = async () => {
      throw new Error("missing_scope");
    };
    const { batch, token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);
    await decideAll(token, imageIds, cookie);

    expect((await post(token, "confirm", {}, cookie)).status).toBe(200);
    await flush();

    expect(await getDeliveredBatchId(db)).toBe(batch.id);
    expect(slack.uploads.some((u) => u.filename.endsWith(".csv"))).toBe(true);
  });

  it("delivers the zip with the confirmation, not on request", async () => {
    // The handoff is the moment the web person needs the files. A command
    // they have to know about and remember is a step at exactly the point
    // where the old process lost things.
    const { token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);
    await decideAll(token, imageIds, cookie);

    await post(token, "confirm", {}, cookie);
    await flush();

    const confirmation = slack.posts.find((p) => p.text.includes("is confirmed"))!;
    const zip = slack.uploads.find((u) => u.filename.endsWith(".zip"));

    expect(zip).toBeDefined();
    // In the confirmation's own thread, so the pinned message carries
    // everything the handoff needs rather than pointing at it.
    expect(zip!.threadTs).toBe(confirmation.ts);
    expect(confirmation.text).toContain("attached below");
  });

  it("says the photos are safe when the zip cannot be built", async () => {
    // Losing the packaging must not read as losing the photographs.
    const { token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);
    await decideAll(token, imageIds, cookie);

    store.get = async () => {
      throw new Error("bucket unreachable");
    };

    expect((await post(token, "confirm", {}, cookie)).status).toBe(200);
    await flush();

    const said = slack.posts.map((p) => p.text).join("\n");
    expect(said).toContain("couldn't build the zip");
    expect(said).toContain("still stored");
    expect(await getDeliveredBatchId(db)).toBe(batchIdOf(said));
  });

  it("cannot be confirmed twice", async () => {
    const { token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);
    await decideAll(token, imageIds, cookie);
    await post(token, "confirm", {}, cookie);

    expect((await post(token, "confirm", {}, cookie)).status).toBe(409);
  });
});

describe("a photo that never arrived", () => {
  /** A batch whose only styled shot failed outright. */
  async function withFailure() {
    const batch = await createBatch(db, { sourceFilename: "catalog.csv" });
    await addBatchRows(db, batch.id, [
      {
        sku: "HG-002",
        productName: "Mug",
        category: "Ceramics",
        colour: "Sage",
        material: "Stoneware",
        price: "$28",
        photoUrl: "https://example.com/a.jpg",
        shotIdea: "kitchen counter",
      },
    ]);
    await startGeneration(db, batch.id);
    await drain(
      {
        db,
        generator: {
          submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
          poll: async () => ({
            state: "failed" as const,
            failureCode: "content_moderated",
            failureReason: null,
            retryable: false,
          }),
        },
        store,
        slack,
        channel: "C_REVIEW",
        model: "uni-1-max" as const,
        aspectRatio: "1:1",
        fetch: fetchOk,
        sleep: async () => {},
      },
      { batchId: batch.id },
    );

    const token = await ensureReviewToken(db, batch.id);
    const { images } = await getProductImages(db, batch.id, "HG-002");
    return { batch, token, images };
  }

  it("does not hold the batch open forever", async () => {
    // The page counted a failed photo as still to review while confirm did
    // not, so the button never appeared for a batch the endpoint would have
    // accepted. Two counts, one truth.
    const { token } = await withFailure();
    const state = (await buildReviewState(db, token))!;

    expect(state.totals.failed).toBeGreaterThan(0);
    expect(state.totals.pending).toBe(0);
  });

  it("can be discarded, and the batch then confirms", async () => {
    const { token, images } = await withFailure();
    const cookie = await signIn(ELLIE);

    expect(
      (await post(token, "decide", { imageId: images[0]!.imageId, decision: "discard" }, cookie))
        .status,
    ).toBe(200);

    // Counting pending by subtraction used to drive this negative once a
    // failed photo was discarded, blocking the batch harder than before.
    expect((await buildReviewState(db, token))!.totals.pending).toBe(0);
    expect((await post(token, "confirm", {}, cookie)).status).toBe(200);
  });

  it("can be tried again, which puts it back in the queue", async () => {
    const { batch, token, images } = await withFailure();
    const cookie = await signIn(ELLIE);

    const res = await post(token, "retry", { imageId: images[0]!.imageId }, cookie);
    expect(res.status).toBe(200);

    const { images: after } = await getProductImages(db, batch.id, "HG-002");
    expect(after[0]!.jobState).toBe("pending_submit");
    // The same row, not a new one: the shot that is missing is this one.
    expect(after).toHaveLength(images.length);
    expect(after[0]!.imageId).toBe(images[0]!.imageId);
  });

  it("actually regenerates once retried", async () => {
    const { batch, token, images } = await withFailure();
    const cookie = await signIn(ELLIE);
    await post(token, "retry", { imageId: images[0]!.imageId }, cookie);

    await drain(
      {
        db,
        generator: {
          submit: async () => ({ generationId: "gen-2", rateLimit: {} }),
          poll: async () => ({ state: "completed" as const, outputUrl: "https://luma/o.jpg" }),
        },
        store,
        slack,
        channel: "C_REVIEW",
        model: "uni-1-max" as const,
        aspectRatio: "1:1",
        fetch: fetchOk,
        sleep: async () => {},
      },
      { batchId: batch.id },
    );

    const { images: after } = await getProductImages(db, batch.id, "HG-002");
    expect(after[0]!.jobState).toBe("posted");
  });

  it("is marked as retried, and filterable as such", async () => {
    // A retried photo looks identical to one that never failed once it
    // arrives, and "which of these needed chasing?" is worth being able to
    // ask afterwards.
    const { token, images } = await withFailure();
    const cookie = await signIn(ELLIE);
    await post(token, "retry", { imageId: images[0]!.imageId }, cookie);

    const state = (await buildReviewState(db, token))!;
    expect(state.totals.retried).toBe(1);
    expect(state.products[0]!.candidates[0]!.retried).toBe(true);

    const html = renderReviewPage(state, token, { canWrite: true });
    expect(html).toContain('data-filter="retried"');
    expect(html).toContain('data-retried="1"');
  });

  it("changes the revision, so an open page notices the retry", async () => {
    // Back in the queue is a change; its state alone can look unmoved.
    const { token, images } = await withFailure();
    const before = (await buildReviewState(db, token))!.revision;

    const cookie = await signIn(ELLIE);
    await post(token, "retry", { imageId: images[0]!.imageId }, cookie);

    expect((await buildReviewState(db, token))!.revision).not.toBe(before);
  });

  it("refuses to retry something that did not fail", async () => {
    const { token, imageIds } = await reviewable();
    const cookie = await signIn(ELLIE);

    const res = await post(token, "retry", { imageId: imageIds[0] }, cookie);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toContain("hasn't failed");
  });

  it("refuses a retry from a reader who is not signed in", async () => {
    const { images, token } = await withFailure();
    expect((await post(token, "retry", { imageId: images[0]!.imageId })).status).toBe(403);
  });

  it("offers try-again and discard, but never approve", async () => {
    const { token } = await withFailure();
    const html = renderReviewPage((await buildReviewState(db, token))!, token, {
      canWrite: true,
    });

    expect(html).toContain("Try again");
    expect(html).toContain("failed-acts");
    // Nothing arrived, so there is nothing to approve.
    const failedBlock = html.slice(html.indexOf("failed-acts"));
    expect(failedBlock.slice(0, 200)).not.toContain("Approve");
  });

  it("offers approve and discard on a photo that arrived but was never posted", async () => {
    // The card this fixes: a product with no shot idea, its own photograph
    // downloaded and stored, Slack refusing the file share. The photo was on
    // the page — and underneath it, a label calling it unavailable and a Try
    // again button, because the posting failure had been recorded against the
    // image. It could be fetched again forever and never approved.
    const batch = await createBatch(db, { sourceFilename: "catalog.csv" });
    await addBatchRows(db, batch.id, [
      {
        sku: "HG-003",
        productName: "Cereal Bowl",
        category: "Ceramics",
        colour: "Blue",
        material: "Stoneware",
        price: "$18",
        photoUrl: "https://example.com/hg-003.jpg",
        shotIdea: null,
      },
    ]);
    await startGeneration(db, batch.id);

    slack.uploadFile = async () => {
      throw new Error("slack refused the upload");
    };
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
        model: "uni-1-max" as const,
        aspectRatio: "1:1",
        fetch: fetchOk,
        sleep: async () => {},
      },
      { batchId: batch.id },
    );

    const token = await ensureReviewToken(db, batch.id);
    const state = (await buildReviewState(db, token))!;
    const html = renderReviewPage(state, token, { canWrite: true });

    // Waiting on a decision like any other photograph, and counted as one.
    expect(state.products[0]!.candidates[0]!.state).toBe("ready");
    expect(state.totals.failedPassThrough).toBe(0);

    expect(html).toContain('<button class="approve">Approve</button>');
    expect(html).toContain("Discard");
    // No retry control on it at all — there is nothing about the photograph
    // to try again.
    expect(html).not.toContain('class="retry"');
    expect(html).not.toContain("failed-acts");
    expect(html).not.toContain("original photo unavailable");
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

describe("TEMPORARY: open write access for the demo", () => {
  /** The same app, with the demo switch on. */
  function openApp() {
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
      openWriteAccess: true,
    });
  }

  const openPost = (token: string, path: string, body: unknown) =>
    openApp().request(`/api/review/${token}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("lets somebody with only the link decide", async () => {
    const { batch, token, imageIds } = await reviewable();

    const res = await openPost(token, "decide", {
      imageId: imageIds[0],
      decision: "approve",
    });

    expect(res.status).toBe(200);
    const { images } = await getProductImages(db, batch.id, "HG-002");
    expect(images.find((i) => i.imageId === imageIds[0])!.decision).toBe("approved");
  });

  it("records that it was an anonymous reviewer, not a person", async () => {
    // A plausible Slack id here would be a lie about who acted.
    const { token, imageIds } = await reviewable();
    await openPost(token, "decide", { imageId: imageIds[0], decision: "approve" });

    const { rows } = await db.query<{ actor: string }>(
      `select actor from decision_events order by id desc limit 1`,
    );
    expect(rows[0]!.actor).toBe("demo-reviewer");
  });

  it("says so on the page, rather than claiming they are signed in", async () => {
    const { token } = await reviewable();
    const html = await (await openApp().request(`/review/${token}`)).text();

    expect(html).toContain("Open review");
    expect(html).toContain("temporary");
    expect(html).not.toContain("You're signed in");
  });

  it("is off unless switched on, so nothing else here is weakened", async () => {
    // The gate, the access list and the sessions are all still in place —
    // every other test in this file proves it. This one pins the default.
    const { token, imageIds } = await reviewable();

    const res = await post(token, "decide", {
      imageId: imageIds[0],
      decision: "approve",
    });
    expect(res.status).toBe(403);
  });
});
