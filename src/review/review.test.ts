import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addBatchRows,
  createBatch,
  ensureReviewToken,
  recordDecision,
  setJobState,
} from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { startGeneration } from "../generation/start.js";
import { drain } from "../generation/worker.js";
import { createApp } from "../slack/app.js";
import { createFakeSlack, type FakeSlack } from "../slack/testing.js";
import { createMemoryStore, type MemoryStore } from "../storage/memory.js";
import { renderReviewPage } from "./page.js";
import { buildReviewState } from "./state.js";

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

async function seed(rows: Array<{ sku: string; shotIdea: string | null }>) {
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
  await startGeneration(db, batch.id);
  return batch;
}

async function runPipeline(batchId: number) {
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
    { batchId },
  );
}

function app() {
  return createApp({
    signingSecret: "s",
    now: () => 1_700_000_000_000,
    defer: () => {},
    db,
    slack,
    store,
    publicBaseUrl: "https://shots.test",
  });
}

describe("review state", () => {
  it("is nothing at all for an unknown token", async () => {
    expect(await buildReviewState(db, "not-a-token")).toBeNull();
  });

  it("shows candidates as generating before they exist", async () => {
    // The page has to be openable the moment the link is posted, which is
    // before any photograph has been made.
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);

    const state = (await buildReviewState(db, token))!;
    expect(state.inProgress).toBe(true);
    expect(state.products[0]!.candidates.every((c) => c.state === "generating")).toBe(true);
    expect(state.products[0]!.candidates.every((c) => c.imageUrl === null)).toBe(true);
  });

  it("shows them ready once the pipeline has run", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);
    await runPipeline(batch.id);

    const state = (await buildReviewState(db, token))!;
    expect(state.inProgress).toBe(false);
    expect(state.products[0]!.candidates.every((c) => c.state === "ready")).toBe(true);
    expect(state.products[0]!.candidates[0]!.imageUrl).toMatch(/^\/img\//);
  });

  it("reflects decisions made in Slack", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);
    await runPipeline(batch.id);

    const { rows } = await db.query<{ id: string }>(
      `select id from images order by slot limit 1`,
    );
    await recordDecision(db, {
      imageId: rows[0]!.id,
      decision: "approve",
      actor: "U_ELLIE",
    });

    const state = (await buildReviewState(db, token))!;
    expect(state.totals.approved).toBe(1);
    expect(state.products[0]!.candidates.some((c) => c.state === "approved")).toBe(true);
  });

  it("marks a candidate that could not be generated", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);
    const { rows } = await db.query<{ image_id: string }>(
      `select image_id from image_jobs limit 1`,
    );
    await setJobState(db, rows[0]!.image_id, "failed", {
      failureCode: "content_moderated",
    });

    const state = (await buildReviewState(db, token))!;
    expect(state.totals.failed).toBe(1);
  });

  it("charges nothing for a pass-through", async () => {
    const batch = await seed([{ sku: "HG-001", shotIdea: null }]);
    const token = await ensureReviewToken(db, batch.id);
    const state = (await buildReviewState(db, token))!;
    expect(state.spentUsd).toBe(0);
    expect(state.products[0]!.isPassThrough).toBe(true);
  });

  it("changes its revision when something the page shows changes", async () => {
    // The page reloads on a revision change, so a stale revision would leave
    // it frozen and a noisy one would make it flicker.
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);

    const before = (await buildReviewState(db, token))!.revision;
    await runPipeline(batch.id);
    const after = (await buildReviewState(db, token))!.revision;

    expect(after).not.toBe(before);
    expect((await buildReviewState(db, token))!.revision).toBe(after);
  });
});

describe("review page", () => {
  it("escapes customer data rather than trusting it", async () => {
    const batch = await createBatch(db, { sourceFilename: "c.csv" });
    await addBatchRows(db, batch.id, [
      {
        sku: "HG-001",
        productName: '<script>alert("x")</script>',
        category: "",
        colour: "",
        material: "",
        price: "",
        photoUrl: "https://example.com/a.jpg",
        shotIdea: null,
      },
    ]);
    const token = await ensureReviewToken(db, batch.id);
    const html = renderReviewPage((await buildReviewState(db, token))!, token);

    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("tells a signed-out reader how to get the ability to decide", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);
    const html = renderReviewPage((await buildReviewState(db, token))!, token);

    expect(html).toContain("Read-only");
    expect(html).toContain("/luma signin");
    // No controls at all for a reader who cannot act.
    expect(html).not.toContain('class="acts"');
  });

  it("shows the controls to a signed-in writer", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);
    await runPipeline(batch.id);

    const html = renderReviewPage((await buildReviewState(db, token))!, token, {
      canWrite: true,
    });
    expect(html).toContain('class="acts"');
    expect(html).toContain("signed in");
  });

  it("polls fast while generating and slowly once settled", async () => {
    // It keeps polling either way: while generating, to fill in photographs;
    // afterwards, because someone else may be deciding at the same time.
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);

    const during = renderReviewPage((await buildReviewState(db, token))!, token);
    expect(during).toContain("setInterval(refresh, 4000)");
    expect(during).toContain("this page updates itself");

    await runPipeline(batch.id);
    const after = renderReviewPage((await buildReviewState(db, token))!, token);
    expect(after).toContain("setInterval(refresh, 15000)");
  });

  it("carries no external stylesheet, script or font", async () => {
    // It has to render on a phone with nothing but the images to fetch.
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);
    const html = renderReviewPage((await buildReviewState(db, token))!, token);

    expect(html).not.toMatch(/<link[^>]+href="http/);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it("asks not to be indexed", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);
    const html = renderReviewPage((await buildReviewState(db, token))!, token);
    expect(html).toContain('name="robots" content="noindex');
  });
});

describe("the routes", () => {
  it("serves the page for a valid token", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);

    const res = await app().request(`/review/${token}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`Batch ${batch.id}`);
  });

  it("404s an unknown token without saying anything about it", async () => {
    const res = await app().request("/review/0000000000000000");
    expect(res.status).toBe(404);
  });

  it("serves the same state as JSON for the poll", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);

    const res = await app().request(`/api/review/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as { batchId: number; revision: string };
    expect(body.batchId).toBe(batch.id);
    expect(body.revision).toBeTruthy();
  });
});

describe("the token", () => {
  it("is long enough to be unguessable", async () => {
    // 128 bits, comfortably past OWASP's 64-bit floor.
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const token = await ensureReviewToken(db, batch.id);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("is stable once assigned, so the link keeps working", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const first = await ensureReviewToken(db, batch.id);
    expect(await ensureReviewToken(db, batch.id)).toBe(first);
  });

  it("differs between batches", async () => {
    const a = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    const b = await createBatch(db, { sourceFilename: "other.csv" });
    expect(await ensureReviewToken(db, a.id)).not.toBe(
      await ensureReviewToken(db, b.id),
    );
  });
});
