import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addBatchRows,
  batchCounts,
  createBatch,
  listDecisionEvents,
  setBatchState,
} from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { startGeneration } from "../generation/start.js";
import { drain } from "../generation/worker.js";
import { createFakeSlack, type FakeSlack } from "../slack/testing.js";
import { createMemoryStore, type MemoryStore } from "../storage/memory.js";
import { decide } from "./decide.js";

const ELLIE = "U_ELLIE";

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

/** A batch with one product, generated and posted, ready to be decided on. */
async function readyBatch() {
  const batch = await createBatch(db, { sourceFilename: "catalog.csv" });
  await addBatchRows(db, batch.id, [
    {
      sku: "HG-002",
      productName: "Stoneware Mug 12oz",
      category: "Ceramics",
      colour: "Sage",
      material: "Stoneware",
      price: "$28",
      photoUrl: "https://example.com/a.jpg",
      shotIdea: "morning kitchen counter",
    },
  ]);
  await startGeneration(db, batch.id);
  await drain(
    {
      db,
      generator,
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

  const { rows } = await db.query<{ id: string; slot: number }>(
    `select id, slot from images order by slot`,
  );
  slack.posts.length = 0;
  slack.updates.length = 0;
  return { batch, imageIds: rows.map((r) => r.id) };
}

const decideWith = (imageId: string, decision: "approve" | "discard", actor = ELLIE) =>
  decide({
    db,
    slack,
    channel: "C_REVIEW",
    imageId,
    decision,
    actorUserId: actor,
    approverUserId: ELLIE,
  });

describe("recording a decision", () => {
  it("stores it as membership", async () => {
    const { batch, imageIds } = await readyBatch();
    const outcome = await decideWith(imageIds[0]!, "approve");

    expect(outcome.ok).toBe(true);
    expect(await batchCounts(db, batch.id)).toMatchObject({ approved: 1, pending: 2 });
  });

  it("records who decided and when", async () => {
    const { imageIds } = await readyBatch();
    await decideWith(imageIds[0]!, "approve");

    const events = await listDecisionEvents(db, imageIds[0]!);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ decision: "approve", actor: ELLIE });
  });

  it("lets a mind be changed, and keeps both events", async () => {
    const { batch, imageIds } = await readyBatch();
    await decideWith(imageIds[0]!, "approve");
    await decideWith(imageIds[0]!, "discard");

    expect(await batchCounts(db, batch.id)).toMatchObject({ approved: 0, discarded: 1 });
    const events = await listDecisionEvents(db, imageIds[0]!);
    expect(events.map((e) => e.decision)).toEqual(["approve", "discard"]);
  });

  it("leaves a product's other candidates alone", async () => {
    // A finished request is two to three approved images, so keeping two of
    // three is a normal outcome rather than a conflict.
    const { batch, imageIds } = await readyBatch();
    await decideWith(imageIds[0]!, "approve");
    await decideWith(imageIds[1]!, "approve");

    expect(await batchCounts(db, batch.id)).toMatchObject({ approved: 2, pending: 1 });
  });
});

describe("who is allowed to decide", () => {
  it("refuses anyone but the approver", async () => {
    const { batch, imageIds } = await readyBatch();
    const outcome = await decideWith(imageIds[0]!, "approve", "U_SOMEONE_ELSE");

    expect(outcome).toMatchObject({ ok: false });
    expect(await batchCounts(db, batch.id)).toMatchObject({ approved: 0 });
  });

  it("tells them what they can still do, rather than just refusing", async () => {
    const { imageIds } = await readyBatch();
    const outcome = await decideWith(imageIds[0]!, "approve", "U_SOMEONE_ELSE");

    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.reason).toContain("say what you think");
  });

  it("records nothing at all for a refused attempt", async () => {
    const { imageIds } = await readyBatch();
    await decideWith(imageIds[0]!, "approve", "U_SOMEONE_ELSE");
    expect(await listDecisionEvents(db, imageIds[0]!)).toHaveLength(0);
  });
});

describe("a confirmed batch", () => {
  it("cannot be changed", async () => {
    const { batch, imageIds } = await readyBatch();
    await setBatchState(db, batch.id, "delivered");

    const outcome = await decideWith(imageIds[0]!, "approve");
    expect(outcome).toMatchObject({ ok: false });
    expect(await batchCounts(db, batch.id)).toMatchObject({ approved: 0 });
  });

  it("says what to do instead", async () => {
    const { batch, imageIds } = await readyBatch();
    await setBatchState(db, batch.id, "delivered");

    const outcome = await decideWith(imageIds[0]!, "approve");
    if (outcome.ok) throw new Error("expected a refusal");
    expect(outcome.reason).toContain("new batch");
  });
});

describe("reflecting the decision back into Slack", () => {
  it("refreshes the product's line with the new count", async () => {
    const { imageIds } = await readyBatch();
    await decideWith(imageIds[0]!, "approve");

    const productLine = slack.updates.find((u) => u.text.startsWith("HG-002"));
    expect(productLine).toBeDefined();
    expect(JSON.stringify(productLine!.blocks)).toContain("1 of 3 decided");
  });

  it("marks the candidate's outcome in the thread", async () => {
    const { imageIds } = await readyBatch();
    await decideWith(imageIds[0]!, "approve");

    const candidate = slack.updates.find((u) => u.text.endsWith(".jpg"));
    expect(candidate).toBeDefined();
    const blocks = JSON.stringify(candidate!.blocks);
    expect(blocks).toContain("Approved");
    // Deciding happens on the page; the thread is for talking about a shot.
    expect(blocks).not.toContain("approve_image");
  });

  it("keeps the decision even when Slack refuses to redraw", async () => {
    // The record is the point; the redraw is decoration. A failure here must
    // not be able to lose what was decided.
    const { batch, imageIds } = await readyBatch();
    slack.updateMessage = async () => {
      throw new Error("message_not_found");
    };

    const outcome = await decideWith(imageIds[0]!, "approve");
    expect(outcome.ok).toBe(true);
    expect(await batchCounts(db, batch.id)).toMatchObject({ approved: 1 });
  });
});
