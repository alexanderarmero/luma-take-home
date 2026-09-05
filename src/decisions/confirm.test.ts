import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addBatchRows,
  addImages,
  createBatch,
  getDeliveredBatchId,
  getBatchState,
  recordDecision,
  setBatchState,
  setJobState,
} from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createFakeSlack, type FakeSlack } from "../slack/testing.js";
import { confirmBatch, offerConfirmationIfComplete } from "./confirm.js";

const ELLIE = "U_ELLIE";
let db: TestDb;
let slack: FakeSlack;

beforeEach(async () => {
  db = await createTestDb();
  slack = createFakeSlack();
});
afterEach(async () => {
  await db?.close();
});

/** A batch of `count` images, already generated and awaiting decisions. */
async function reviewableBatch(count = 3) {
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
      shotIdea: "kitchen",
    },
  ]);
  const images = await addImages(
    db,
    batch.id,
    Array.from({ length: count }, (_, i) => ({
      sku: "HG-002",
      productName: "Mug",
      slot: i + 1,
      kind: "styled" as const,
      filename: `HG-002_kitchen_0${i + 1}.jpg`,
    })),
  );
  await setBatchState(db, batch.id, "ready_for_review");
  return { batch, imageIds: images.map((i) => i.id) };
}

const offer = (batchId: number, batchState: string) =>
  offerConfirmationIfComplete({
    db,
    slack,
    channel: "C_REVIEW",
    batchId,
    batchState,
    approverUserId: ELLIE,
  });

async function decideAll(imageIds: string[], decision: "approve" | "discard" = "approve") {
  for (const imageId of imageIds) {
    await recordDecision(db, { imageId, decision, actor: ELLIE });
  }
}

describe("offering the handover", () => {
  it("stays quiet while anything is undecided", async () => {
    const { batch, imageIds } = await reviewableBatch();
    await decideAll(imageIds.slice(0, 2));

    expect(await offer(batch.id, "ready_for_review")).toBe(false);
    expect(slack.posts).toHaveLength(0);
  });

  it("appears the moment nothing is left undecided", async () => {
    const { batch, imageIds } = await reviewableBatch();
    await decideAll(imageIds);

    expect(await offer(batch.id, "ready_for_review")).toBe(true);
    expect(slack.posts).toHaveLength(1);
    expect(JSON.stringify(slack.posts[0]!.blocks)).toContain("confirm_batch");
  });

  it("says what confirming will do before it is done", async () => {
    const { batch, imageIds } = await reviewableBatch();
    await decideAll(imageIds);
    await offer(batch.id, "ready_for_review");

    const blocks = JSON.stringify(slack.posts[0]!.blocks);
    expect(blocks).toContain("3* approved");
    expect(blocks).toContain("can't be changed afterwards");
  });

  it("counts a discard as decided, not as unfinished", async () => {
    const { batch, imageIds } = await reviewableBatch();
    await decideAll(imageIds.slice(0, 2), "approve");
    await decideAll(imageIds.slice(2), "discard");

    expect(await offer(batch.id, "ready_for_review")).toBe(true);
  });

  it("is offered only once", async () => {
    const { batch, imageIds } = await reviewableBatch();
    await decideAll(imageIds);

    await offer(batch.id, "ready_for_review");
    const state = await getBatchState(db, batch.id);
    expect(await offer(batch.id, state)).toBe(false);
    expect(slack.posts).toHaveLength(1);
  });

  it("is not offered for a batch with nothing in it", async () => {
    const batch = await createBatch(db, { sourceFilename: "empty.csv" });
    await setBatchState(db, batch.id, "ready_for_review");
    expect(await offer(batch.id, "ready_for_review")).toBe(false);
  });
});

describe("confirming", () => {
  const confirm = (batchId: number, actor = ELLIE) =>
    confirmBatch({ db, batchId, actorUserId: actor, approverUserId: ELLIE });

  it("freezes the batch and makes it the delivered one", async () => {
    const { batch, imageIds } = await reviewableBatch();
    await decideAll(imageIds);

    const outcome = await confirm(batch.id);
    expect(outcome).toMatchObject({ ok: true, approved: 3 });
    expect(await getBatchState(db, batch.id)).toBe("delivered");
    expect(await getDeliveredBatchId(db)).toBe(batch.id);
  });

  it("refuses while anything is still undecided, and says how many", async () => {
    const { batch, imageIds } = await reviewableBatch();
    await decideAll(imageIds.slice(0, 1));

    const outcome = await confirm(batch.id);
    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.reason).toContain("2 undecided");
    expect(await getDeliveredBatchId(db)).toBeNull();
  });

  it("refuses anyone but the approver", async () => {
    const { batch, imageIds } = await reviewableBatch();
    await decideAll(imageIds);

    expect(await confirm(batch.id, "U_MAYA")).toMatchObject({ ok: false });
    expect(await getDeliveredBatchId(db)).toBeNull();
  });

  it("refuses a second confirmation of the same batch", async () => {
    const { batch, imageIds } = await reviewableBatch();
    await decideAll(imageIds);
    await confirm(batch.id);

    expect(await confirm(batch.id)).toMatchObject({ ok: false });
  });

  it("never lets an unconfirmed batch become the delivered one", async () => {
    // However recent it is. The pointer only moves on a human confirmation.
    const first = await reviewableBatch();
    await decideAll(first.imageIds);
    await confirm(first.batch.id);

    const second = await reviewableBatch();
    expect(second.batch.id).toBeGreaterThan(first.batch.id);
    expect(await getDeliveredBatchId(db)).toBe(first.batch.id);
  });
});

describe("regressions found in review", () => {
  const confirm = (batchId: number, actor = ELLIE) =>
    confirmBatch({ db, batchId, actorUserId: actor, approverUserId: ELLIE });

  it("can still be confirmed when a photo failed to generate", async () => {
    // A failed image never gets buttons, so it can never be decided. Counting
    // it as outstanding leaves the batch permanently unconfirmable — and
    // `/luma status` says the opposite, because it excludes failures.
    const { batch, imageIds } = await reviewableBatch(3);
    await setJobState(db, imageIds[2]!, "failed", { failureCode: "content_moderated" });
    await decideAll(imageIds.slice(0, 2));

    expect(await offer(batch.id, "ready_for_review")).toBe(true);
    expect(await confirm(batch.id)).toMatchObject({ ok: true });
  });

  it("never moves the delivered pointer backwards", async () => {
    // A confirm message stays in the channel with a live button. Clicking an
    // old one must not hand the web person a superseded batch.
    const first = await reviewableBatch(1);
    await decideAll(first.imageIds);
    await confirm(first.batch.id);

    const second = await reviewableBatch(1);
    await decideAll(second.imageIds);
    await confirm(second.batch.id);
    expect(await getDeliveredBatchId(db)).toBe(second.batch.id);

    // The stale button from the first batch.
    expect(await confirm(first.batch.id)).toMatchObject({ ok: false });
    expect(await getDeliveredBatchId(db)).toBe(second.batch.id);
  });

  it("can still offer confirmation after a failed post", async () => {
    // Moving the state before the message goes out leaves the batch with no
    // button and no way to get one.
    const { batch, imageIds } = await reviewableBatch(1);
    await decideAll(imageIds);

    slack.postMessage = async () => {
      throw new Error("ratelimited");
    };
    await expect(offer(batch.id, "ready_for_review")).rejects.toThrow();

    slack = createFakeSlack();
    expect(
      await offerConfirmationIfComplete({
        db,
        slack,
        channel: "C_REVIEW",
        batchId: batch.id,
        batchState: await getBatchState(db, batch.id),
        approverUserId: ELLIE,
      }),
    ).toBe(true);
  });
});
