import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addBatchRows, batchCounts, claimNextJob, createBatch } from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createFakeSlack, type FakeSlack } from "../slack/testing.js";
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
    expect(result).toEqual({ styled: 3, passThrough: 1 });
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

    expect(slack.uploads).toHaveLength(3);
    expect(slack.uploads[0]!.filename).toBe(
      "HG-002_morning-kitchen-counter_01.jpg",
    );
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

    const blocks = JSON.stringify(slack.uploads[0]!.blocks);
    expect(blocks).toContain("approve_image");
    expect(blocks).toContain("discard_image");
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

    expect(slack.uploads.map((u) => u.filename)).toEqual([
      "HG-002_morning-kitchen_01.jpg",
      "HG-002_morning-kitchen_02.jpg",
      "HG-002_morning-kitchen_03.jpg",
      "HG-005_dinner-table_01.jpg",
      "HG-005_dinner-table_02.jpg",
      "HG-005_dinner-table_03.jpg",
    ]);
  });

  it("uploads exactly the bytes it stored", async () => {
    // The file that ships must be the file that was approved.
    const batch = await seed([{ sku: "HG-002", shotIdea: "morning kitchen" }]);
    await startGeneration(db, batch.id);
    await drain(deps(), { batchId: batch.id });

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
    expect(slack.uploads).toHaveLength(1);
    expect(slack.uploads[0]!.filename).toBe("HG-001_original.jpg");
    expect(JSON.stringify(slack.uploads[0]!.blocks)).toContain("nothing was changed");
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

    expect(slack.uploads.length).toBeGreaterThan(0);
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
    expect(slack.uploads).toHaveLength(0);
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
    expect(slack.uploads).toHaveLength(0);

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
    expect(slack.uploads).toHaveLength(3);
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
    expect(slack.uploads).toHaveLength(7);
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

    expect(slack.uploads).toHaveLength(4);
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
