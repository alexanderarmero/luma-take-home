import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addBatchRows,
  addImages,
  createBatch,
  markImageStored,
  recordDecision,
  setBatchState,
  setDeliveredBatch,
  setJobState,
  setProductMessageTs,
} from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createFakeSlack, type FakeSlack } from "../slack/testing.js";
import { createMemoryStore, type MemoryStore } from "../storage/memory.js";
import { buildStatusSummary } from "./status.js";

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

const status = (extra: Record<string, unknown> = {}) =>
  buildStatusSummary({ db, slack, channel: "C_REVIEW", ...extra });

async function batchWith(
  products: Array<{ sku: string; slots: number; shotIdea?: string | null }>,
) {
  const batch = await createBatch(db, { sourceFilename: "catalog.csv" });
  await addBatchRows(
    db,
    batch.id,
    products.map((p) => ({
      sku: p.sku,
      productName: `Product ${p.sku}`,
      category: "Ceramics",
      colour: "Sage",
      material: "Stoneware",
      price: "$28",
      photoUrl: "https://example.com/a.jpg",
      shotIdea: p.shotIdea === undefined ? "kitchen" : p.shotIdea,
    })),
  );

  const images = await addImages(
    db,
    batch.id,
    products.flatMap((p) =>
      Array.from({ length: p.slots }, (_, i) => ({
        sku: p.sku,
        productName: `Product ${p.sku}`,
        slot: i + 1,
        kind: "styled" as const,
        filename: `${p.sku}_kitchen_0${i + 1}.jpg`,
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
  for (const p of products) {
    await setProductMessageTs(db, batch.id, p.sku, "1700000000.000100");
  }
  await setBatchState(db, batch.id, "ready_for_review");
  return { batch, images };
}

const approve = (id: string) =>
  recordDecision(db, { imageId: id, decision: "approve", actor: ELLIE });
const discard = (id: string) =>
  recordDecision(db, { imageId: id, decision: "discard", actor: ELLIE });

describe("with nothing to report", () => {
  it("says so plainly", async () => {
    expect((await status()).toLowerCase()).toContain("no batches");
  });
});

describe("a batch that was uploaded but never started", () => {
  it("says so, rather than looking like one mid-generation", async () => {
    // Reachable since the recap became a modal: closing it leaves the rows
    // behind with nothing ever generated.
    await createBatch(db, { sourceFilename: "catalog.csv" });

    const text = await status();
    expect(text).toContain("never started");
    expect(text).toContain("nothing has been generated");
    expect(text).toContain("/luma upload");
  });
});

describe("the summary", () => {
  it("counts approved, discarded and outstanding", async () => {
    const { images } = await batchWith([{ sku: "HG-002", slots: 3 }]);
    await approve(images[0]!.id);
    await discard(images[1]!.id);

    const text = await status();
    expect(text).toContain("1 approved");
    expect(text).toContain("1 discarded");
    expect(text).toContain("1 still to review");
  });

  it("reports what has been spent", async () => {
    await batchWith([{ sku: "HG-002", slots: 3 }]);
    expect(await status()).toMatch(/\$0\.\d\d spent/);
  });

  it("mentions photos that could not be generated", async () => {
    const { images } = await batchWith([{ sku: "HG-002", slots: 2 }]);
    await setJobState(db, images[0]!.id, "failed", { failureCode: "content_moderated" });
    expect(await status()).toContain("couldn't be generated");
  });
});

describe("what to do next", () => {
  it("lists the products still needing a decision", async () => {
    const { images } = await batchWith([
      { sku: "HG-002", slots: 2 },
      { sku: "HG-005", slots: 2 },
    ]);
    for (const image of images.slice(0, 2)) await approve(image.id);

    const text = await status();
    expect(text).toContain("Still needing you (1)");
    expect(text).toContain("HG-005");
    expect(text).not.toMatch(/HG-002 · Product HG-002 \(/);
  });

  it("deep-links each one, so it is a tap rather than a scroll", async () => {
    await batchWith([{ sku: "HG-002", slots: 2 }]);
    expect(await status()).toContain("https://example.slack.com/archives/C_REVIEW/p");
  });

  it("says how many are left on each", async () => {
    const { images } = await batchWith([{ sku: "HG-002", slots: 3 }]);
    await approve(images[0]!.id);
    expect(await status()).toContain("(2 left)");
  });

  it("stops listing before it becomes a wall, and says how many more", async () => {
    await batchWith(
      Array.from({ length: 20 }, (_, i) => ({
        sku: `HG-${String(i + 1).padStart(3, "0")}`,
        slots: 1,
      })),
    );
    const text = await status();
    expect(text).toContain("Still needing you (20)");
    expect(text).toContain("and 8 more");
  });

  it("asks for confirmation once everything is decided", async () => {
    // Describes what is needed next, rather than what has happened.
    const { images } = await batchWith([{ sku: "HG-002", slots: 2 }]);
    for (const image of images) await approve(image.id);

    const text = await status();
    expect(text).toContain("awaiting your confirmation");
    expect(text).not.toContain("Still needing you");
  });

  it("says when a batch has been handed over", async () => {
    const { batch, images } = await batchWith([{ sku: "HG-002", slots: 1 }]);
    for (const image of images) await approve(image.id);
    await setBatchState(db, batch.id, "delivered");
    await setDeliveredBatch(db, batch.id);

    const text = await status();
    expect(text).toContain("Confirmed and handed over");
    expect(text).toContain(`batch #${batch.id}`);
  });
});

describe("under-delivery", () => {
  it("names products that finished with fewer than two approved shots", async () => {
    // Silence here would look identical to success.
    const { images } = await batchWith([{ sku: "HG-002", slots: 3 }]);
    await approve(images[0]!.id);
    await discard(images[1]!.id);
    await discard(images[2]!.id);

    const text = await status();
    expect(text).toContain("fewer than two approved");
    expect(text).toContain("HG-002");
  });

  it("stays quiet when every product got enough", async () => {
    const { images } = await batchWith([{ sku: "HG-002", slots: 3 }]);
    for (const image of images) await approve(image.id);
    expect(await status()).not.toContain("fewer than two");
  });

  it("does not count a product still being decided", async () => {
    const { images } = await batchWith([{ sku: "HG-002", slots: 3 }]);
    await approve(images[0]!.id);
    expect(await status()).not.toContain("fewer than two");
  });
});

describe("the overview link", () => {
  it("is included when the service knows its own address", async () => {
    await batchWith([{ sku: "HG-002", slots: 1 }]);
    const text = await status({ publicBaseUrl: "https://shots.test" });
    expect(text).toMatch(/Overview: https:\/\/shots\.test\/review\/[0-9a-f]{32}/);
  });

  it("is left out when it does not", async () => {
    await batchWith([{ sku: "HG-002", slots: 1 }]);
    expect(await status()).not.toContain("Overview:");
  });
});

describe("regressions found in review", () => {
  it("does not call a photo still being generated 'still to review'", async () => {
    // Otherwise a batch mid-generation tells the reviewer to go and look at
    // photographs that are not there yet.
    const { batch } = await batchWith([{ sku: "HG-002", slots: 3 }]);
    await db.query(`update image_jobs set state = 'submitted' where batch_id = $1`, [
      batch.id,
    ]);

    const text = await status();
    expect(text).toContain("0 still to review");
    expect(text).not.toContain("Still needing you");
  });

  it("counts spend from submission, not from the row existing", async () => {
    const { batch } = await batchWith([{ sku: "HG-002", slots: 3 }]);
    await db.query(`update image_jobs set state = 'pending_submit' where batch_id = $1`, [
      batch.id,
    ]);
    expect(await status()).toContain("$0.00 spent");
  });

  it("fetches the deep links in parallel, so the listing fits the ack window", async () => {
    // A dozen sequential round trips does not fit inside three seconds.
    let inFlight = 0;
    let peak = 0;
    slack.getPermalink = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return "https://example.slack.com/archives/C/p1";
    };

    await batchWith(
      Array.from({ length: 5 }, (_, i) => ({ sku: `HG-00${i + 1}`, slots: 1 })),
    );
    await status();
    expect(peak).toBeGreaterThan(1);
  });
});
