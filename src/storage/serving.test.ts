import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addBatchRows, addImages, createBatch, markImageStored } from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createApp } from "../slack/app.js";
import { createFakeSlack } from "../slack/testing.js";
import { createMemoryStore, type MemoryStore } from "./memory.js";

const BYTES = Buffer.from("jpeg bytes");

let db: TestDb;
let store: MemoryStore;

beforeEach(async () => {
  db = await createTestDb();
  store = createMemoryStore();
});
afterEach(async () => {
  await db?.close();
});

function app() {
  return createApp({
    signingSecret: "s",
    now: () => 1_700_000_000_000,
    defer: () => {},
    db,
    store,
    slack: createFakeSlack(),
  });
}

/** Stores one image and returns the id embedded in its object key. */
async function storeOneImage(filename = "HG-002_morning-kitchen_01.jpg") {
  const batch = await createBatch(db, { sourceFilename: "c.csv" });
  await addBatchRows(db, batch.id, [
    {
      sku: "HG-002",
      productName: "Mug",
      category: "Ceramics",
      colour: "Sage",
      material: "Stoneware",
      price: "$28",
      photoUrl: "https://example.com/a.jpg",
      shotIdea: "morning kitchen",
    },
  ]);
  const [image] = await addImages(db, batch.id, [
    {
      sku: "HG-002",
      productName: "Mug",
      slot: 1,
      kind: "styled",
      filename,
    },
  ]);
  const stored = await store.put({
    bytes: BYTES,
    contentType: "image/jpeg",
    filename,
  });
  await markImageStored(db, image!.id, {
    objectKey: stored.key,
    checksum: stored.checksum,
  });
  return stored.key.replace("images/", "").replace(".jpg", "");
}

describe("GET /img/:id", () => {
  it("serves the exact bytes that were stored", async () => {
    const id = await storeOneImage();
    const res = await app().request(`/img/${id}`);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(BYTES)).toBe(true);
  });

  it("attaches the meaningful filename even though the URL is random", async () => {
    // The two properties the design needs at once: an unguessable link that
    // still downloads under a name the web person can trust.
    const id = await storeOneImage();
    const res = await app().request(`/img/${id}`);
    expect(res.headers.get("content-disposition")).toContain(
      "HG-002_morning-kitchen_01.jpg",
    );
    expect(id).not.toContain("HG-002");
  });

  it("accepts the id with or without a .jpg suffix", async () => {
    const id = await storeOneImage();
    expect((await app().request(`/img/${id}.jpg`)).status).toBe(200);
  });

  it("is cacheable, since an object key never changes meaning", async () => {
    const id = await storeOneImage();
    const res = await app().request(`/img/${id}`);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("404s an unknown id rather than leaking anything", async () => {
    const res = await app().request("/img/2b0f1f9c-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });

  it("reports honestly when storage is not configured", async () => {
    const res = await createApp({
      signingSecret: "s",
      now: () => 1,
      defer: () => {},
      db,
    }).request("/img/anything");
    expect(res.status).toBe(503);
  });
});
