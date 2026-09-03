import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addImages,
  createBatch,
  recordDecision,
  setDeliveredBatch,
} from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { buildStatusSummary } from "./status.js";

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db?.close();
});

const img = (sku: string, slot: number) => ({
  sku,
  productName: `Product ${sku}`,
  slot,
  kind: "styled" as const,
  filename: `${sku}_scene_0${slot}.jpg`,
});

describe("buildStatusSummary", () => {
  it("says so plainly when nothing has been uploaded yet", async () => {
    const text = await buildStatusSummary(db);
    expect(text.toLowerCase()).toContain("no batches");
  });

  it("reports counts for the latest batch", async () => {
    const batch = await createBatch(db, { sourceFilename: "catalog.csv" });
    const images = await addImages(db, batch.id, [
      img("HG-002", 1),
      img("HG-002", 2),
      img("HG-005", 1),
    ]);
    await recordDecision(db, {
      imageId: images[0]!.id,
      decision: "approve",
      actor: "U_ELLIE",
    });

    const text = await buildStatusSummary(db);
    expect(text).toContain("catalog.csv");
    expect(text).toMatch(/1\D+approved/i);
    expect(text).toMatch(/2\D+pending/i);
  });

  it("never claims work that has not been committed", async () => {
    // Counts are derived from committed rows, so a batch with no images
    // reports zero rather than an optimistic figure from anywhere else.
    const batch = await createBatch(db, { sourceFilename: "empty.csv" });
    const text = await buildStatusSummary(db);
    expect(text).toContain("empty.csv");
    expect(text).toMatch(/0\D+images/i);
    expect(batch.id).toBeGreaterThan(0);
  });

  it("distinguishes the latest batch from the delivered one", async () => {
    const delivered = await createBatch(db, { sourceFilename: "shipped.csv" });
    await setDeliveredBatch(db, delivered.id);
    await createBatch(db, { sourceFilename: "in-progress.csv" });

    const text = await buildStatusSummary(db);
    expect(text).toContain("in-progress.csv");
    expect(text).toContain(`#${delivered.id}`);
  });
});
