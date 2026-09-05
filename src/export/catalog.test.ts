import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addBatchRows,
  addImages,
  createBatch,
  markImageStored,
  recordDecision,
  setJobState,
} from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createMemoryStore, type MemoryStore } from "../storage/memory.js";
import { buildApprovedCatalog, buildGeneratedCatalog } from "./catalog.js";

const BASE = "https://shots.test";
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

async function batchWith(
  rows: Array<{ sku: string; shotIdea: string | null; slots: number }>,
) {
  const batch = await createBatch(db, { sourceFilename: "catalog.csv" });
  await addBatchRows(
    db,
    batch.id,
    rows.map((r) => ({
      sku: r.sku,
      productName: `Product ${r.sku}`,
      category: "Ceramics",
      colour: "Sage",
      material: "Stoneware",
      price: "$28",
      photoUrl: "https://example.com/a.jpg",
      shotIdea: r.shotIdea,
    })),
  );

  const images = await addImages(
    db,
    batch.id,
    rows.flatMap((r) =>
      Array.from({ length: r.slots }, (_, i) => ({
        sku: r.sku,
        productName: `Product ${r.sku}`,
        slot: i + 1,
        kind: (r.shotIdea === null ? "pass_through" : "styled") as
          | "pass_through"
          | "styled",
        filename:
          r.shotIdea === null
            ? `${r.sku}_original.jpg`
            : `${r.sku}_kitchen_0${i + 1}.jpg`,
      })),
    ),
  );

  for (const image of images) {
    const stored = await store.put({
      bytes: Buffer.from(image.filename),
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

const parse = (csv: string) => csv.split("\n").map((line) => line.split(","));

describe("the generated catalog", () => {
  it("gives each shot its own column", async () => {
    // Three URLs crammed into one cell is not something anyone can sort,
    // filter or click — and a spreadsheet is the whole point of the format.
    const { batch } = await batchWith([{ sku: "HG-002", shotIdea: "kitchen", slots: 3 }]);
    const csv = await buildGeneratedCatalog(db, batch.id, BASE);
    const [header] = parse(csv.content);

    expect(header!).toContain("Photo 1");
    expect(header!).toContain("Photo 2");
    expect(header!).toContain("Photo 3");
  });

  it("widens to the product with the most shots", async () => {
    const { batch } = await batchWith([
      { sku: "HG-001", shotIdea: null, slots: 1 },
      { sku: "HG-002", shotIdea: "kitchen", slots: 3 },
    ]);
    const [header] = parse((await buildGeneratedCatalog(db, batch.id, BASE)).content);
    expect(header!.filter((h) => h.startsWith("Photo "))).toHaveLength(3);
  });

  it("links to images by a permanent, unguessable url", async () => {
    const { batch } = await batchWith([{ sku: "HG-002", shotIdea: "kitchen", slots: 1 }]);
    const csv = await buildGeneratedCatalog(db, batch.id, BASE);

    expect(csv.content).toContain(`${BASE}/img/`);
    // No SKU in the url itself: the link is unguessable, the file it downloads
    // is still named properly.
    const url = csv.content.match(/https:\/\/shots\.test\/img\/[^,\n]+/)![0];
    expect(url).not.toContain("HG-002");
  });

  it("leaves a product that generated nothing in the file, marked as such", async () => {
    const { batch, images } = await batchWith([
      { sku: "HG-002", shotIdea: "kitchen", slots: 1 },
    ]);
    await setJobState(db, images[0]!.id, "failed", { failureCode: "content_moderated" });

    const csv = await buildGeneratedCatalog(db, batch.id, BASE);
    expect(csv.content).toContain("HG-002");
    expect(csv.content).toContain("none generated");
  });

  it("quotes a shot idea containing commas", async () => {
    const { batch } = await batchWith([
      { sku: "HG-002", shotIdea: "morning kitchen counter, steam, warm light", slots: 1 },
    ]);
    const csv = await buildGeneratedCatalog(db, batch.id, BASE);
    expect(csv.content).toContain('"morning kitchen counter, steam, warm light"');
  });

  it("is named for its batch", async () => {
    const { batch } = await batchWith([{ sku: "HG-002", shotIdea: "kitchen", slots: 1 }]);
    const csv = await buildGeneratedCatalog(db, batch.id, BASE);
    expect(csv.filename).toBe(`batch-${batch.id}-generated.csv`);
  });
});

describe("the approved catalog", () => {
  it("carries only what was approved", async () => {
    const { batch, images } = await batchWith([
      { sku: "HG-002", shotIdea: "kitchen", slots: 3 },
    ]);
    await recordDecision(db, { imageId: images[0]!.id, decision: "approve", actor: ELLIE });
    await recordDecision(db, { imageId: images[1]!.id, decision: "discard", actor: ELLIE });

    const csv = await buildApprovedCatalog(db, batch.id, BASE);
    const [, row] = parse(csv.content);
    const urls = row!.filter((c) => c.startsWith("https://"));
    expect(urls).toHaveLength(1);
  });

  it("never exposes a discarded image", async () => {
    const { batch, images } = await batchWith([
      { sku: "HG-002", shotIdea: "kitchen", slots: 2 },
    ]);
    await recordDecision(db, { imageId: images[1]!.id, decision: "discard", actor: ELLIE });

    const csv = await buildApprovedCatalog(db, batch.id, BASE);
    const discarded = await db.query<{ object_key: string }>(
      `select object_key from images where id = $1`,
      [images[1]!.id],
    );
    const key = discarded.rows[0]!.object_key.replace("images/", "").replace(".jpg", "");
    expect(csv.content).not.toContain(key);
  });

  it("counts how many each product ended up with", async () => {
    // The column the source spreadsheet never had: which requests are done.
    const { batch, images } = await batchWith([
      { sku: "HG-002", shotIdea: "kitchen", slots: 3 },
    ]);
    await recordDecision(db, { imageId: images[0]!.id, decision: "approve", actor: ELLIE });
    await recordDecision(db, { imageId: images[1]!.id, decision: "approve", actor: ELLIE });

    const csv = await buildApprovedCatalog(db, batch.id, BASE);
    const [header, row] = parse(csv.content);
    expect(header!).toContain("Approved");
    expect(row![header!.indexOf("Approved")]).toBe("2");
  });

  it("keeps a product that ended with nothing, showing zero", async () => {
    const { batch } = await batchWith([{ sku: "HG-002", shotIdea: "kitchen", slots: 2 }]);
    const csv = await buildApprovedCatalog(db, batch.id, BASE);
    expect(csv.content).toContain("HG-002");
    const [header, row] = parse(csv.content);
    expect(row![header!.indexOf("Approved")]).toBe("0");
  });

  it("is named for its batch", async () => {
    const { batch } = await batchWith([{ sku: "HG-002", shotIdea: "kitchen", slots: 1 }]);
    const csv = await buildApprovedCatalog(db, batch.id, BASE);
    expect(csv.filename).toBe(`batch-${batch.id}-approved.csv`);
  });
});
