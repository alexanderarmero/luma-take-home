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
    const args = { imageId: image!.id, actor: "U_ELLIE" };

    await recordDecision(db, { ...args, decision: "approve" });
    await recordDecision(db, { ...args, decision: "discard" });

    const counts = await batchCounts(db, batch.id);
    expect(counts).toMatchObject({ approved: 0, discarded: 1 });
  });

  it("never leaves an image in both relations at once", async () => {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    const [image] = await addImages(db, batch.id, [rows("HG-002", 1)]);
    const args = { imageId: image!.id, actor: "U_ELLIE" };

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
    const args = { imageId: image!.id, actor: "U_ELLIE" };

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
      decision: "approve",
      actor: "U_ELLIE",
    });
    await recordDecision(db, {
      imageId: images[1]!.id,
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

describe("job rows", () => {
  it("keeps a pass-through out of the paid submission path", async () => {
    // Its output is the customer's original photo. If it started at
    // 'pending_submit' the worker would submit all 24 blank-shot-idea rows in
    // the real catalog to the image API, and the recap's "free" would be a lie.
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    await addImages(db, batch.id, [
      { ...rows("HG-001", 1), kind: "pass_through" },
      rows("HG-002", 1),
    ]);

    const { rows: jobs } = await db.query<{ state: string; filename: string }>(
      `select j.state, i.filename from image_jobs j
       join images i on i.id = j.image_id
       order by i.sku`,
    );
    expect(jobs.map((j) => j.state)).toEqual(["pending_fetch", "pending_submit"]);
  });

  it("gives every image a job row, so none is invisible to the worker", async () => {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    await addImages(db, batch.id, [rows("HG-002", 1), rows("HG-002", 2)]);
    const { rows: jobs } = await db.query(`select image_id from image_jobs`);
    expect(jobs).toHaveLength(2);
  });
});

describe("addImages atomicity", () => {
  it("leaves nothing behind when one row in the batch fails", async () => {
    // A partially ingested batch would report a total lower than the catalog,
    // and completion is checked against that total — so a truncated batch
    // could be confirmed and delivered as though it were whole.
    const batch = await createBatch(db, { sourceFilename: "c.csv" });

    await expect(
      addImages(db, batch.id, [
        rows("HG-002", 1),
        rows("HG-005", 1),
        rows("HG-002", 1), // duplicate (batch, sku, slot)
      ]),
    ).rejects.toThrow();

    const counts = await batchCounts(db, batch.id);
    expect(counts.total).toBe(0);
  });
});

describe("decision provenance", () => {
  it("files the decision under the image's own batch", async () => {
    const other = await createBatch(db, { sourceFilename: "other.csv" });
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    const [image] = await addImages(db, batch.id, [rows("HG-002", 1)]);

    await recordDecision(db, {
      imageId: image!.id,
      decision: "approve",
      actor: "U_ELLIE",
    });

    const { rows: membership } = await db.query<{ batch_id: string }>(
      `select batch_id from approved_images where image_id = $1`,
      [image!.id],
    );
    expect(Number(membership[0]!.batch_id)).toBe(batch.id);
    expect(await batchCounts(db, other.id)).toMatchObject({ approved: 0 });
  });

  it("never reports a negative pending count", async () => {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    const images = await addImages(db, batch.id, [rows("HG-002", 1)]);
    await recordDecision(db, {
      imageId: images[0]!.id,
      decision: "approve",
      actor: "U_ELLIE",
    });
    const counts = await batchCounts(db, batch.id);
    expect(counts.pending).toBeGreaterThanOrEqual(0);
  });
});
