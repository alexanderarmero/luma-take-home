import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addBatchRows,
  addImages,
  createBatch,
  markImageStored,
  recordDecision,
  setDeliveredBatch,
} from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createMemoryStore, type MemoryStore } from "../storage/memory.js";
import { buildLatestExport } from "./zip.js";

const ELLIE = "U_ELLIE";
let db: TestDb;
let store: MemoryStore;

beforeEach(async () => {
  db = await createTestDb();
  store = createMemoryStore();
});
afterEach(async () => {
  await db?.close();
});

const bytesFor = (name: string) => Buffer.from(`jpeg-of-${name}`);

/** A batch whose images are stored, ready to be decided on. */
async function storedBatch(skus: string[] = ["HG-002", "HG-005"]) {
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
      shotIdea: "kitchen",
    })),
  );

  const images = await addImages(
    db,
    batch.id,
    skus.flatMap((sku) =>
      [1, 2].map((slot) => ({
        sku,
        productName: `Product ${sku}`,
        slot,
        kind: "styled" as const,
        filename: `${sku}_kitchen_0${slot}.jpg`,
      })),
    ),
  );

  for (const image of images) {
    const stored = await store.put({
      bytes: bytesFor(image.filename),
      contentType: "image/jpeg",
      filename: image.filename,
    });
    await markImageStored(db, image.id, {
      objectKey: stored.key,
      checksum: stored.checksum,
    });
  }

  return { batch, images };
}

const approve = (imageId: string) =>
  recordDecision(db, { imageId, decision: "approve", actor: ELLIE });
const discard = (imageId: string) =>
  recordDecision(db, { imageId, decision: "discard", actor: ELLIE });

async function entriesOf(bytes: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(bytes);
  return Object.keys(zip.files).sort();
}

describe("nothing to export", () => {
  it("says so when nothing has been confirmed", async () => {
    await storedBatch();
    const result = await buildLatestExport(db, store);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).toContain("Nothing has been confirmed");
  });

  it("refuses a confirmed batch with nothing approved in it", async () => {
    const { batch, images } = await storedBatch(["HG-002"]);
    for (const image of images) await discard(image.id);
    await setDeliveredBatch(db, batch.id);

    expect(await buildLatestExport(db, store)).toMatchObject({ ok: false });
  });
});

describe("the zip", () => {
  it("holds exactly the approved photos", async () => {
    const { batch, images } = await storedBatch(["HG-002"]);
    await approve(images[0]!.id);
    await discard(images[1]!.id);
    await setDeliveredBatch(db, batch.id);

    const result = await buildLatestExport(db, store);
    if (!result.ok) throw new Error(result.reason);

    const entries = await entriesOf(result.bytes);
    expect(entries).toContain("HG-002_kitchen_01.jpg");
    // The discarded one is unreachable through this path, by construction.
    expect(entries).not.toContain("HG-002_kitchen_02.jpg");
  });

  it("names every file for its product and shot idea", async () => {
    const { batch, images } = await storedBatch(["HG-002"]);
    for (const image of images) await approve(image.id);
    await setDeliveredBatch(db, batch.id);

    const result = await buildLatestExport(db, store);
    if (!result.ok) throw new Error(result.reason);
    const entries = await entriesOf(result.bytes);
    expect(entries).toEqual([
      "HG-002_kitchen_01.jpg",
      "HG-002_kitchen_02.jpg",
      "MANIFEST.txt",
    ]);
  });

  it("carries the bytes that were stored, unchanged", async () => {
    // The file that ships is the file that was approved.
    const { batch, images } = await storedBatch(["HG-002"]);
    await approve(images[0]!.id);
    await setDeliveredBatch(db, batch.id);

    const result = await buildLatestExport(db, store);
    if (!result.ok) throw new Error(result.reason);

    const zip = await JSZip.loadAsync(result.bytes);
    const inZip = await zip.file("HG-002_kitchen_01.jpg")!.async("nodebuffer");
    expect(inZip.equals(bytesFor("HG-002_kitchen_01.jpg"))).toBe(true);
  });

  it("includes a manifest listing each file with its checksum", async () => {
    const { batch, images } = await storedBatch(["HG-002"]);
    await approve(images[0]!.id);
    await setDeliveredBatch(db, batch.id);

    const result = await buildLatestExport(db, store);
    if (!result.ok) throw new Error(result.reason);

    const zip = await JSZip.loadAsync(result.bytes);
    const manifest = await zip.file("MANIFEST.txt")!.async("string");
    expect(manifest).toContain("HG-002_kitchen_01.jpg");
    expect(manifest).toMatch(/[0-9a-f]{64}/);
  });

  it("is named for the batch it came from", async () => {
    const { batch, images } = await storedBatch(["HG-002"]);
    await approve(images[0]!.id);
    await setDeliveredBatch(db, batch.id);

    const result = await buildLatestExport(db, store);
    if (!result.ok) throw new Error(result.reason);
    expect(result.filename).toBe(`batch-${batch.id}-approved.zip`);
  });
});

describe("reading through the delivered pointer", () => {
  it("returns the confirmed batch, not the newest one", async () => {
    // A batch mid-review must be unreachable however recent it is.
    const older = await storedBatch(["HG-002"]);
    await approve(older.images[0]!.id);
    await setDeliveredBatch(db, older.batch.id);

    const newer = await storedBatch(["HG-005"]);
    await approve(newer.images[0]!.id);
    expect(newer.batch.id).toBeGreaterThan(older.batch.id);

    const result = await buildLatestExport(db, store);
    if (!result.ok) throw new Error(result.reason);
    expect(result.batchId).toBe(older.batch.id);
    expect(await entriesOf(result.bytes)).not.toContain("HG-005_kitchen_01.jpg");
  });

  it("follows the pointer when a newer batch is confirmed", async () => {
    const older = await storedBatch(["HG-002"]);
    await approve(older.images[0]!.id);
    await setDeliveredBatch(db, older.batch.id);

    const newer = await storedBatch(["HG-005"]);
    await approve(newer.images[0]!.id);
    await setDeliveredBatch(db, newer.batch.id);

    const result = await buildLatestExport(db, store);
    if (!result.ok) throw new Error(result.reason);
    expect(result.batchId).toBe(newer.batch.id);
  });
});
