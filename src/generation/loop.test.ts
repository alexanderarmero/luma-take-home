import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addBatchRows, createBatch, setBatchState } from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import {
  allImageFilenames,
  createFakeSlack,
  type FakeSlack,
} from "../slack/testing.js";
import { createMemoryStore, type MemoryStore } from "../storage/memory.js";
import type { ImageGenerator } from "./generator.js";
import { tick } from "./loop.js";
import { startGeneration } from "./start.js";
import type { WorkerDeps } from "./worker.js";

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

const generator: ImageGenerator = {
  submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
  poll: async () => ({ state: "completed", outputUrl: "https://luma/out.jpg" }),
};

function deps(gen: ImageGenerator = generator): WorkerDeps {
  return {
    db,
    generator: gen,
    store,
    slack,
    channel: "C_REVIEW",
    model: "uni-1-max",
    aspectRatio: "1:1",
    fetch: fetchOk,
    sleep: async () => {},
  };
}

async function seedBatch(rows: Array<{ sku: string; shotIdea: string | null }>) {
  const batch = await createBatch(db, { sourceFilename: "c.csv" });
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
  await setBatchState(db, batch.id, "generating");
  return batch;
}

describe("tick", () => {
  it("does nothing when there is no work", async () => {
    expect(await tick(deps())).toBe(0);
    expect(slack.posts).toHaveLength(0);
  });

  it("finishes a batch and announces it once", async () => {
    const batch = await seedBatch([{ sku: "HG-002", shotIdea: "kitchen" }]);

    await tick(deps(), { approverUserId: "U_ELLIE" });

    expect(allImageFilenames(slack)).toHaveLength(3);
    const announcements = slack.posts.filter((p) => p.text.includes(`#${batch.id}`));
    expect(announcements).toHaveLength(1);
    expect(announcements[0]!.text).toContain("<@U_ELLIE>");
  });

  it("does not announce the same batch twice", async () => {
    await seedBatch([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await tick(deps(), { approverUserId: "U_ELLIE" });
    const after = slack.posts.length;

    await tick(deps(), { approverUserId: "U_ELLIE" });
    expect(slack.posts).toHaveLength(after);
  });

  it("does not announce a batch that is still running", async () => {
    // Half-finished must look different from finished, or the team is told a
    // batch is ready when it is not.
    const stalls: ImageGenerator = {
      submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
      poll: async () => ({ state: "pending" }),
    };
    await seedBatch([{ sku: "HG-002", shotIdea: "kitchen" }]);

    await tick(deps(stalls), { approverUserId: "U_ELLIE", maxStepsPerTick: 8 });

    expect(slack.posts.filter((p) => p.text.includes("ready for review"))).toHaveLength(0);
  });

  it("picks up work a previous process left behind", async () => {
    // The resume path: a batch whose generations were submitted by a process
    // that no longer exists still finishes.
    await seedBatch([{ sku: "HG-002", shotIdea: "kitchen" }]);

    const stalls: ImageGenerator = {
      submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
      poll: async () => ({ state: "pending" }),
    };
    await tick(deps(stalls), { maxStepsPerTick: 8 });
    expect(allImageFilenames(slack)).toHaveLength(0);

    const { rows } = await db.query<{ state: string }>(`select state from image_jobs`);
    expect(rows.every((r) => r.state === "submitted")).toBe(true);

    // A fresh process, with the generations now complete.
    await tick(deps(), { approverUserId: "U_ELLIE" });
    expect(allImageFilenames(slack)).toHaveLength(3);
  });

  it("announces a batch even when every image failed", async () => {
    // Silence would leave the team waiting for images that are never coming.
    const moderated: ImageGenerator = {
      submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
      poll: async () => ({
        state: "failed",
        failureCode: "content_moderated",
        failureReason: "policy",
        retryable: false,
      }),
    };
    await seedBatch([{ sku: "HG-002", shotIdea: "kitchen" }]);

    await tick(deps(moderated), { approverUserId: "U_ELLIE" });

    const announcement = slack.posts.find((p) => p.text.includes("ready for review"));
    expect(announcement).toBeDefined();
    // Says how many never arrived. A missing photo is otherwise
    // indistinguishable from one still on its way.
    expect(announcement!.text).toContain("3");
    expect(announcement!.text.toLowerCase()).toContain("didn't arrive");
  });

  it("points the summons at the page where deciding happens", async () => {
    // The one ping per batch has to carry the thing it is summoning you to.
    await seedBatch([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await tick(deps(), {
      approverUserId: "U_ELLIE",
      publicBaseUrl: "https://shots.test",
    });

    const announcement = slack.posts.find((p) => p.text.includes("ready for review"));
    expect(announcement!.text).toMatch(/https:\/\/shots\.test\/review\/\w+/);
  });

  it("reports how many photos actually made it", async () => {
    await seedBatch([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await tick(deps(), { approverUserId: "U_ELLIE" });
    const announcement = slack.posts.find((p) => p.text.includes("ready for review"));
    expect(announcement!.text).toContain("*3* photos are above");
  });

  it("does not mention failures when there were none", async () => {
    await seedBatch([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await tick(deps(), { approverUserId: "U_ELLIE" });
    const announcement = slack.posts.find((p) => p.text.includes("ready for review"));
    expect(announcement!.text.toLowerCase()).not.toContain("didn't arrive");
  });
});
