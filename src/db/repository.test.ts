import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SqlClient } from "./client.js";
import { migrate } from "./migrate.js";
import {
  addImages,
  batchCounts,
  createBatch,
  getDeliveredBatchId,
  listDecisionEvents,
  recordDecision,
  setDeliveredBatch,
} from "./repository.js";
import { createTestDb } from "./testing.js";

let db: SqlClient & { close(): Promise<void> };

beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

const rows = (sku: string, slot: number) => ({
  sku,
  productName: `Product ${sku}`,
  slot,
  kind: "styled" as const,
  filename: `${sku}_scene_0${slot}.jpg`,
});

describe("migrations", () => {
  it("are idempotent, so booting twice is safe", async () => {
    const second = await migrate(db);
    expect(second).toEqual([]);
  });
});

describe("schema shape", () => {
  it("has no decision status column on images", async () => {
    // Decision state is membership in approved_images / discarded_images.
    // A status column here is the shape this design explicitly rejected.
    const { rows: cols } = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'images'`,
    );
    const names = cols.map((c) => c.column_name);
    expect(names).not.toContain("status");
    expect(names).not.toContain("approved");
    expect(names).not.toContain("state");
  });
});

describe("batches", () => {
  it("assigns an incrementing identifier at upload time", async () => {
    const first = await createBatch(db, { sourceFilename: "catalog.csv" });
    const second = await createBatch(db, { sourceFilename: "drop.csv" });
    expect(second.id).toBeGreaterThan(first.id);
  });
});

describe("decisions", () => {
  it("records an approval as membership, not as a column", async () => {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    const [image] = await addImages(db, batch.id, [rows("HG-002", 1)]);

    await recordDecision(db, {
      imageId: image!.id,
      batchId: batch.id,
      decision: "approve",
      actor: "U_ELLIE",
    });

    const { rows: approved } = await db.query(
      "select image_id from approved_images",
    );
    expect(approved).toHaveLength(1);
  });

  it("moves an image between relations when the decision changes", async () => {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    const [image] = await addImages(db, batch.id, [rows("HG-002", 1)]);
    const args = { imageId: image!.id, batchId: batch.id, actor: "U_ELLIE" };

    await recordDecision(db, { ...args, decision: "approve" });
    await recordDecision(db, { ...args, decision: "discard" });

    const counts = await batchCounts(db, batch.id);
    expect(counts).toMatchObject({ approved: 0, discarded: 1 });
  });

  it("never leaves an image in both relations at once", async () => {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    const [image] = await addImages(db, batch.id, [rows("HG-002", 1)]);
    const args = { imageId: image!.id, batchId: batch.id, actor: "U_ELLIE" };

    await recordDecision(db, { ...args, decision: "approve" });
    await recordDecision(db, { ...args, decision: "discard" });
    await recordDecision(db, { ...args, decision: "approve" });

    const { rows: both } = await db.query(
      `select image_id from approved_images
       intersect
       select image_id from discarded_images`,
    );
    expect(both).toEqual([]);
  });

  it("appends an event for every action, including reversals", async () => {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    const [image] = await addImages(db, batch.id, [rows("HG-002", 1)]);
    const args = { imageId: image!.id, batchId: batch.id, actor: "U_ELLIE" };

    await recordDecision(db, { ...args, decision: "approve" });
    await recordDecision(db, { ...args, decision: "discard" });

    const events = await listDecisionEvents(db, image!.id);
    expect(events.map((e) => e.decision)).toEqual(["approve", "discard"]);
    expect(events.every((e) => e.actor === "U_ELLIE")).toBe(true);
  });

  it("is idempotent when the same decision is repeated", async () => {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    const [image] = await addImages(db, batch.id, [rows("HG-002", 1)]);
    const args = {
      imageId: image!.id,
      batchId: batch.id,
      actor: "U_ELLIE",
      decision: "approve" as const,
    };

    await recordDecision(db, args);
    await recordDecision(db, args);

    expect(await batchCounts(db, batch.id)).toMatchObject({ approved: 1 });
  });
});

describe("batchCounts", () => {
  it("reports zeroes for a batch with no images", async () => {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    expect(await batchCounts(db, batch.id)).toEqual({
      total: 0,
      approved: 0,
      discarded: 0,
      pending: 0,
    });
  });

  it("counts an undecided image as pending", async () => {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    const images = await addImages(db, batch.id, [
      rows("HG-002", 1),
      rows("HG-002", 2),
      rows("HG-005", 1),
    ]);

    await recordDecision(db, {
      imageId: images[0]!.id,
      batchId: batch.id,
      decision: "approve",
      actor: "U_ELLIE",
    });
    await recordDecision(db, {
      imageId: images[1]!.id,
      batchId: batch.id,
      decision: "discard",
      actor: "U_ELLIE",
    });

    expect(await batchCounts(db, batch.id)).toEqual({
      total: 3,
      approved: 1,
      discarded: 1,
      pending: 1,
    });
  });
});

describe("delivered pointer", () => {
  it("points at nothing before anything has been confirmed", async () => {
    await createBatch(db, { sourceFilename: "c.csv" });
    expect(await getDeliveredBatchId(db)).toBeNull();
  });

  it("does not follow the highest batch id", async () => {
    // A batch that was uploaded but never confirmed must be unreachable by
    // retrieval, no matter how recent it is.
    const delivered = await createBatch(db, { sourceFilename: "old.csv" });
    await setDeliveredBatch(db, delivered.id);
    const newer = await createBatch(db, { sourceFilename: "in-progress.csv" });

    expect(newer.id).toBeGreaterThan(delivered.id);
    expect(await getDeliveredBatchId(db)).toBe(delivered.id);
  });

  it("advances when a newer batch is confirmed", async () => {
    const first = await createBatch(db, { sourceFilename: "a.csv" });
    const second = await createBatch(db, { sourceFilename: "b.csv" });
    await setDeliveredBatch(db, first.id);
    await setDeliveredBatch(db, second.id);
    expect(await getDeliveredBatchId(db)).toBe(second.id);
  });
});
