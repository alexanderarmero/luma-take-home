import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addBatchRows, batchCounts, claimNextJob, createBatch } from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import {
  allImageFilenames,
  channelProductMessages,
  createFakeSlack,
  type FakeSlack,
} from "../slack/testing.js";
import { createMemoryStore, type MemoryStore } from "../storage/memory.js";
import { GenerationError, type ImageGenerator } from "./generator.js";
import { startGeneration } from "./start.js";
import { drain, runOnce, type WorkerDeps } from "./worker.js";

const PHOTO = "https://example.com/hg-002.jpg";
const OUTPUT = "https://luma/out.jpg";
const IMAGE_BYTES = Buffer.from("jpeg-ish bytes");

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
  new Response(IMAGE_BYTES, {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  })) as unknown as typeof fetch;

function generator(overrides: Partial<ImageGenerator> = {}): ImageGenerator {
  return {
    submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
    poll: async () => ({ state: "completed", outputUrl: OUTPUT }),
    ...overrides,
  };
}

function deps(gen: ImageGenerator = generator()): WorkerDeps {
  return {
    db,
    generator: gen,
    store,
    slack,
    channel: "C_REVIEW",
    model: "uni-1-max",
    aspectRatio: "1:1",
    fetch: fetchOk,
  };
}

async function seed(rows: Array<{ sku: string; shotIdea: string | null }>) {
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
      photoUrl: PHOTO,
      shotIdea: r.shotIdea,
    })),
  );
  return batch;
}

describe("startGeneration", () => {
  it("makes candidates for shot ideas and one pass-through for a blank", async () => {
    const batch = await seed([
      { sku: "HG-002", shotIdea: "morning kitchen counter" },
      { sku: "HG-001", shotIdea: null },
    ]);

    const result = await startGeneration(db, batch.id);
    expect(result).toMatchObject({ styled: 3, passThrough: 1 });
    expect(await batchCounts(db, batch.id)).toMatchObject({ total: 4, pending: 4 });
  });

  it("queues a pass-through so it never reaches the paid submission path", async () => {
    const batch = await seed([{ sku: "HG-001", shotIdea: null }]);
    await startGeneration(db, batch.id);
    const job = await claimNextJob(db, batch.id);
    expect(job?.state).toBe("pending_fetch");
  });
});

describe("a styled image, end to end", () => {
  it("submits, polls, stores and posts", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "morning kitchen counter" }]);
    await startGeneration(db, batch.id);

    await drain(deps(), { batchId: batch.id });

    // One line in the channel, three photographs in its thread.
    expect(channelProductMessages(slack)).toHaveLength(1);
    expect(allImageFilenames(slack)).toEqual([
      "HG-002_morning-kitchen-counter_01.jpg",
      "HG-002_morning-kitchen-counter_02.jpg",
      "HG-002_morning-kitchen-counter_03.jpg",
    ]);
    expect(slack.uploads.every((u) => u.threadTs !== undefined)).toBe(true);
    expect(store.objects.size).toBe(3);
  });

  it("edits the product's own photo rather than inventing one", async () => {
    const submit = vi.fn(async (input: { sourceUrl: string }) => {
      void input;
      return { generationId: "gen-1", rateLimit: {} };
    });
    const batch = await seed([{ sku: "HG-002", shotIdea: "morning kitchen" }]);
    await startGeneration(db, batch.id);

    await drain(deps(generator({ submit })), { batchId: batch.id });

    expect(submit.mock.calls[0]![0]).toMatchObject({ sourceUrl: PHOTO });
  });

  it("puts Approve and Discard on every image", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "morning kitchen" }]);
    await startGeneration(db, batch.id);
    await drain(deps(), { batchId: batch.id });

    // A decision pair on each candidate, in the thread — not one for the
    // product as a whole.
    expect(slack.uploads).toHaveLength(3);
    for (const upload of slack.uploads) {
      const blocks = JSON.stringify(upload.blocks);
      expect(blocks).toContain("approve_image");
      expect(blocks).toContain("discard_image");
    }
  });

  it("shows the prompt that produced the image", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "morning kitchen counter" }]);
    await startGeneration(db, batch.id);
    await drain(deps(), { batchId: batch.id });
    expect(JSON.stringify(slack.uploads[0]!.blocks)).toContain(
      "morning kitchen counter",
    );
  });

  it("posts a product's candidates adjacently and in slot order", async () => {
    // Adjacency is what makes a scrolled stream reviewable at all.
    const batch = await seed([
      { sku: "HG-002", shotIdea: "morning kitchen" },
      { sku: "HG-005", shotIdea: "dinner table" },
    ]);
    await startGeneration(db, batch.id);
    await drain(deps(), { batchId: batch.id });

    expect(allImageFilenames(slack)).toEqual([
      "HG-002_morning-kitchen_01.jpg",
      "HG-002_morning-kitchen_02.jpg",
      "HG-002_morning-kitchen_03.jpg",
      "HG-005_dinner-table_01.jpg",
      "HG-005_dinner-table_02.jpg",
      "HG-005_dinner-table_03.jpg",
    ]);
    // Two products, two lines in the channel.
    expect(channelProductMessages(slack)).toHaveLength(2);
  });

  it("uploads exactly the bytes it stored", async () => {
    // The file that ships must be the file that was approved.
    const batch = await seed([{ sku: "HG-002", shotIdea: "morning kitchen" }]);
    await startGeneration(db, batch.id);
    await drain(deps(), { batchId: batch.id });

    // The bytes Slack holds are the bytes we stored — no re-encode anywhere.
    const storedBytes = [...store.objects.values()][0]!.bytes;
    expect(slack.uploads[0]!.bytes.equals(storedBytes)).toBe(true);
    expect(slack.uploads[0]!.bytes.equals(IMAGE_BYTES)).toBe(true);
  });
});

describe("a pass-through", () => {
  it("costs nothing and is labelled as the original", async () => {
    const submit = vi.fn();
    const batch = await seed([{ sku: "HG-001", shotIdea: null }]);
    await startGeneration(db, batch.id);

    await drain(deps(generator({ submit: submit as never })), { batchId: batch.id });

    expect(submit).not.toHaveBeenCalled();
    expect(allImageFilenames(slack)).toEqual(["HG-001_original.jpg"]);
    expect(JSON.stringify(channelProductMessages(slack)[0]!.blocks)).toContain(
      "unchanged",
    );
  });
});

describe("failures", () => {
  it("retries a transient model error", async () => {
    let polls = 0;
    const poll = async () => {
      polls += 1;
      return polls === 1
        ? ({ state: "failed", failureCode: "generation_failed", failureReason: null, retryable: true } as const)
        : ({ state: "completed", outputUrl: OUTPUT } as const);
    };

    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);
    await drain(deps(generator({ poll })), { batchId: batch.id });

    expect(slack.posts.length).toBeGreaterThan(0);
  });

  it("stops on a moderated prompt instead of burning money on retries", async () => {
    const poll = async () =>
      ({ state: "failed", failureCode: "content_moderated", failureReason: "policy", retryable: false }) as const;

    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);
    await drain(deps(generator({ poll })), { batchId: batch.id });

    const { rows } = await db.query<{ state: string; attempts: number }>(
      `select state, attempts from image_jobs`,
    );
    expect(rows.every((r) => r.state === "failed")).toBe(true);
    expect(rows.every((r) => r.attempts === 0)).toBe(true);
    expect(slack.posts).toHaveLength(0);
  });

  it("submits everything it can, then waits rather than declaring the batch done", async () => {
    const poll = async () => ({ state: "pending" }) as const;
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    const worked = await drain(
      { ...deps(generator({ poll })), sleep: async () => {} },
      { batchId: batch.id, maxSteps: 20 },
    );

    // All three candidates get submitted; none can be posted while their
    // generations are still running.
    expect(worked).toBe(3);
    expect(slack.posts).toHaveLength(0);

    const { rows } = await db.query<{ state: string }>(`select state from image_jobs`);
    expect(rows.every((r) => r.state === "submitted")).toBe(true);
  });

  it("gives up after repeated failures rather than retrying forever", async () => {
    const submit = async () => {
      throw new GenerationError("upstream down", true);
    };
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    for (let i = 0; i < 10; i++) await runOnce(deps(generator({ submit })), batch.id);

    const { rows } = await db.query<{ state: string }>(`select state from image_jobs`);
    expect(rows.some((r) => r.state === "failed")).toBe(true);
  });
});

describe("resuming after a crash", () => {
  it("picks a job up from its last committed stage without paying twice", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    // One step, then "the process dies" mid-batch.
    await runOnce(deps(), batch.id);
    const midway = await claimNextJob(db, batch.id);
    expect(midway?.state).toBe("submitted");
    expect(midway?.generationId).toBe("gen-1");
    const resumedImageId = midway!.imageId;

    // A brand new worker, as after a restart. Its siblings still need
    // submitting; the one already in flight must not be submitted again.
    const submitted: string[] = [];
    const submit = async (input: { userId: string }) => {
      submitted.push(input.userId);
      return { generationId: "gen-resumed", rateLimit: {} };
    };
    await drain(deps(generator({ submit })), { batchId: batch.id });

    expect(submitted).not.toContain(resumedImageId);
    expect(submitted).toHaveLength(2); // only the two untouched candidates
    expect(allImageFilenames(slack)).toHaveLength(3);
  });

  it("keeps the generation id it already paid for", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);
    await runOnce(deps(), batch.id);

    const before = await claimNextJob(db, batch.id);
    await runOnce(deps(generator({ poll: async () => ({ state: "pending" }) })), batch.id);
    const after = await claimNextJob(db, batch.id);

    expect(after?.imageId).toBe(before?.imageId);
    expect(after?.generationId).toBe(before?.generationId);
  });
});

describe("polling a generation that is not instant", () => {
  /** Completed only after `pendingPolls` polls, like a real generation. */
  function slowGenerator(pendingPolls: number): ImageGenerator {
    const seen = new Map<string, number>();
    return {
      submit: async (input) => ({
        generationId: `gen-${input.userId}`,
        rateLimit: {},
      }),
      poll: async (id) => {
        const n = (seen.get(id) ?? 0) + 1;
        seen.set(id, n);
        return n <= pendingPolls
          ? ({ state: "pending" } as const)
          : ({ state: "completed", outputUrl: OUTPUT } as const);
      },
    };
  }

  it("finishes every image even though none completes on the first poll", async () => {
    // The real API queues work. A fake that returns `completed` immediately
    // hides whether the loop can wait at all.
    const batch = await seed([
      { sku: "HG-001", shotIdea: null },
      { sku: "HG-002", shotIdea: "morning kitchen" },
      { sku: "HG-005", shotIdea: "dinner table" },
    ]);
    await startGeneration(db, batch.id);

    await drain(
      { ...deps(slowGenerator(2)), sleep: async () => {} },
      { batchId: batch.id },
    );

    // 1 pass-through + two products at 3 candidates each.
    expect(allImageFilenames(slack)).toHaveLength(7);
    expect(store.objects.size).toBe(7);
  });

  it("moves on to other work rather than blocking on one slow generation", async () => {
    const batch = await seed([
      { sku: "HG-002", shotIdea: "morning kitchen" },
      { sku: "HG-009", shotIdea: null },
    ]);
    await startGeneration(db, batch.id);

    await drain(
      { ...deps(slowGenerator(3)), sleep: async () => {} },
      { batchId: batch.id },
    );

    expect(allImageFilenames(slack)).toHaveLength(4);
  });

  it("waits between polls instead of spinning", async () => {
    const sleeps: number[] = [];
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    await drain(
      {
        ...deps(slowGenerator(2)),
        sleep: async (ms: number) => {
          sleeps.push(ms);
        },
      },
      { batchId: batch.id },
    );

    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.every((ms) => ms >= 1000)).toBe(true);
  });
});

describe("posting order", () => {
  /** Completes generations in a deliberately jumbled order. */
  function jumbledGenerator(completeAfter: Record<string, number>): ImageGenerator {
    const polls = new Map<string, number>();
    return {
      submit: async (input) => ({ generationId: input.userId, rateLimit: {} }),
      poll: async (id) => {
        const n = (polls.get(id) ?? 0) + 1;
        polls.set(id, n);
        const threshold = completeAfter[id] ?? 1;
        return n >= threshold
          ? ({ state: "completed", outputUrl: OUTPUT } as const)
          : ({ state: "pending" } as const);
      },
    };
  }

  async function seedTwoProducts() {
    const batch = await seed([
      { sku: "HG-002", shotIdea: "morning kitchen" },
      { sku: "HG-005", shotIdea: "dinner table" },
    ]);
    await startGeneration(db, batch.id);
    return batch;
  }

  it("keeps a product's candidates together even when they finish out of order", async () => {
    // The reported symptom: candidates scattered through the stream because
    // whichever generation finished first was posted first.
    const batch = await seedTwoProducts();

    const { rows } = await db.query<{ image_id: string; sku: string; slot: number }>(
      `select j.image_id, i.sku, i.slot from image_jobs j
         join images i on i.id = j.image_id order by i.sku, i.slot`,
    );
    // Make the last candidate of the first product the slowest of all.
    const completeAfter: Record<string, number> = {};
    rows.forEach((r, index) => {
      completeAfter[r.image_id] = r.sku === "HG-002" && r.slot === 3 ? 6 : 1;
    });

    await drain(
      { ...deps(jumbledGenerator(completeAfter)), sleep: async () => {} },
      { batchId: batch.id },
    );

    const posted = allImageFilenames(slack);
    const skuOrder = posted.map((f) => f.slice(0, 6));
    // Each product's three appear consecutively, never interleaved.
    expect(new Set(skuOrder.slice(0, 3)).size).toBe(1);
    expect(new Set(skuOrder.slice(3, 6)).size).toBe(1);
  });

  it("posts a product's candidates in slot order", async () => {
    const batch = await seedTwoProducts();
    await drain({ ...deps(), sleep: async () => {} }, { batchId: batch.id });

    const forProduct = allImageFilenames(slack).filter((f) =>
      f.startsWith("HG-002"),
    );
    expect(forProduct).toEqual([
      "HG-002_morning-kitchen_01.jpg",
      "HG-002_morning-kitchen_02.jpg",
      "HG-002_morning-kitchen_03.jpg",
    ]);
  });

  it("holds a product back until every candidate has settled", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    const { rows } = await db.query<{ image_id: string; slot: number }>(
      `select j.image_id, i.slot from image_jobs j
         join images i on i.id = j.image_id order by i.slot`,
    );
    const stalled = rows[2]!.image_id;

    // Two finish immediately, one never does.
    await drain(
      {
        ...deps(
          jumbledGenerator({
            [rows[0]!.image_id]: 1,
            [rows[1]!.image_id]: 1,
            [stalled]: 9999,
          }),
        ),
        sleep: async () => {},
      },
      { batchId: batch.id, maxSteps: 30 },
    );

    // Nothing posted: the set is incomplete, so it waits rather than
    // dribbling out.
    expect(slack.posts).toHaveLength(0);
  });

  it("does not let one failed candidate hold its siblings hostage", async () => {
    // Promise.allSettled, not Promise.all: a moderated candidate is finished,
    // just unsuccessfully, and the other two should still reach the reviewer.
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    const { rows } = await db.query<{ image_id: string; slot: number }>(
      `select j.image_id, i.slot from image_jobs j
         join images i on i.id = j.image_id order by i.slot`,
    );
    const doomed = rows[1]!.image_id;

    const generatorWithOneRefusal: ImageGenerator = {
      submit: async (input) => ({ generationId: input.userId, rateLimit: {} }),
      poll: async (id) =>
        id === doomed
          ? ({
              state: "failed",
              failureCode: "content_moderated",
              failureReason: "policy",
              retryable: false,
            } as const)
          : ({ state: "completed", outputUrl: OUTPUT } as const),
    };

    await drain(
      { ...deps(generatorWithOneRefusal), sleep: async () => {} },
      { batchId: batch.id },
    );

    expect(allImageFilenames(slack)).toEqual([
      "HG-002_kitchen_01.jpg",
      "HG-002_kitchen_03.jpg",
    ]);
    // Both survivors in the thread, with the refusal explained there too.
    expect(channelProductMessages(slack)).toHaveLength(1);
    expect(JSON.stringify(slack.posts)).toContain("content filter");
  });
});
