import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addBatchRows,
  batchCounts,
  claimNextJob,
  createBatch,
  getProductImages,
} from "../db/repository.js";
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

describe("being told to slow down", () => {
  it("does not spend one of the image's attempts", async () => {
    // The bug this fixes: a busy batch converts its own impatience into
    // permanent failures. Four refusals in a few seconds and an image that
    // would have generated perfectly well is marked as never having arrived.
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    let calls = 0;
    const throttling: ImageGenerator = {
      submit: async () => {
        calls += 1;
        if (calls <= 6) {
          throw new GenerationError("HTTP 429: rate limited", true, 1, true);
        }
        return { generationId: "gen-1", rateLimit: {} };
      },
      poll: async () => ({ state: "completed", outputUrl: "https://luma/o.jpg" }),
    };

    await drain(
      { ...deps(throttling), sleep: async () => {} },
      { batchId: batch.id, maxSteps: 60 },
    );

    // Six refusals, far past MAX_ATTEMPTS, and it still generated.
    const { images } = await getProductImages(db, batch.id, "HG-002");
    expect(images.some((i) => i.jobState === "failed")).toBe(false);
    expect(calls).toBeGreaterThan(6);
  });

  it("still gives up on a failure that is genuinely the image's", async () => {
    // The exemption is for throttling only; a real error must still exhaust.
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    const broken: ImageGenerator = {
      submit: async () => {
        throw new GenerationError("HTTP 500: upstream", true);
      },
      poll: async () => ({ state: "completed", outputUrl: "https://luma/o.jpg" }),
    };

    await drain(
      { ...deps(broken), sleep: async () => {} },
      { batchId: batch.id, maxSteps: 60 },
    );

    const { images } = await getProductImages(db, batch.id, "HG-002");
    expect(images.every((i) => i.jobState === "failed")).toBe(true);
  });
});

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

  it("carries no decision controls in the thread", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "morning kitchen" }]);
    await startGeneration(db, batch.id);
    await drain(deps(), { batchId: batch.id });

    // No controls in Slack: the thread is for talking about a shot, and
    // deciding happens on the page where the whole set is visible at once.
    expect(slack.uploads).toHaveLength(3);
    for (const upload of slack.uploads) {
      expect(JSON.stringify(upload.blocks)).not.toContain("actions");
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

describe("Luma's concurrent capacity", () => {
  it("stops starting generations once the account is full", async () => {
    // Luma caps concurrent capacity, not just request rate: ten weight units
    // at three per image edit is three at a time. Pacing against the
    // request-rate headers does not help — the window can be nearly full and
    // the request still refused.
    const batch = await seed([
      { sku: "HG-002", shotIdea: "kitchen" },
      { sku: "HG-003", shotIdea: "shelf" },
    ]);
    await startGeneration(db, batch.id);

    let inFlight = 0;
    let peak = 0;
    const counting: ImageGenerator = {
      submit: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        return { generationId: `gen-${inFlight}`, rateLimit: {} };
      },
      poll: async () => {
        inFlight -= 1;
        return { state: "completed", outputUrl: OUTPUT };
      },
    };

    await drain(
      { ...deps(counting), maxConcurrentGenerations: 3, sleep: async () => {} },
      { batchId: batch.id, maxSteps: 200 },
    );

    expect(peak).toBeLessThanOrEqual(3);
  });

  it("keeps polling while at capacity, because that is what frees it", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    let polls = 0;
    const slow: ImageGenerator = {
      submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
      poll: async () => {
        polls += 1;
        return polls < 3
          ? { state: "pending" }
          : { state: "completed", outputUrl: OUTPUT };
      },
    };

    await drain(
      { ...deps(slow), maxConcurrentGenerations: 1, sleep: async () => {} },
      { batchId: batch.id, maxSteps: 200 },
    );

    expect(polls).toBeGreaterThanOrEqual(3);
    const { images } = await getProductImages(db, batch.id, "HG-002");
    expect(images.every((i) => i.jobState === "posted")).toBe(true);
  });

  it("finishes the batch rather than reporting itself idle at capacity", async () => {
    // "Idle" would end the drain and strand everything not yet submitted.
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    await drain(
      { ...deps(), maxConcurrentGenerations: 1, sleep: async () => {} },
      { batchId: batch.id, maxSteps: 200 },
    );

    const { images } = await getProductImages(db, batch.id, "HG-002");
    expect(images).toHaveLength(3);
    expect(images.every((i) => i.jobState === "posted")).toBe(true);
  });

});

describe("what a failure records", () => {
  /** Captures the structured events the worker emits. */
  function recording() {
    const events: Array<Record<string, unknown>> = [];
    return { events, observe: (e: Record<string, unknown>) => events.push(e) };
  }

  it("names the stage, because that is the whole diagnosis", async () => {
    // "attempt 1 failed" on a pass-through could be the source photo, our
    // bucket, or Slack refusing the post. Those have nothing to do with each
    // other, and the old log could not tell them apart.
    const batch = await seed([{ sku: "HG-003", shotIdea: null }]);
    await startGeneration(db, batch.id);
    const { events, observe } = recording();

    await drain(
      {
        ...deps(),
        observe,
        fetch: (async () =>
          new Response(null, { status: 404 })) as unknown as typeof fetch,
        sleep: async () => {},
      },
      { batchId: batch.id, maxSteps: 40 },
    );

    const failure = events.find((e) => e.event === "pipeline.error")!;
    expect(failure.stage).toBe("pending_fetch");
    expect(failure.kind).toBe("pass_through");
    expect(failure.sku).toBe("HG-003");
    expect(String(failure.message)).toContain("404");
  });

  it("distinguishes a posting failure from a copying one", async () => {
    // Both used to read "attempt 1 failed" against a pass-through, which is
    // how nineteen of them failed in one batch with no recorded cause.
    const batch = await seed([{ sku: "HG-003", shotIdea: null }]);
    await startGeneration(db, batch.id);
    const { events, observe } = recording();

    const failingSlack = createFakeSlack();
    failingSlack.postMessage = async () => {
      throw new Error("ratelimited");
    };

    await drain(
      { ...deps(), slack: failingSlack, observe, sleep: async () => {} },
      { batchId: batch.id, maxSteps: 40 },
    );

    const failure = events.find((e) => e.event === "pipeline.error")!;
    expect(failure.stage).toBe("stored");
    expect(String(failure.message)).toContain("ratelimited");
  });

  it("marks a throttled attempt as such, so it is not read as a fault", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);
    const { events, observe } = recording();

    let calls = 0;
    const throttling: ImageGenerator = {
      submit: async () => {
        calls += 1;
        if (calls <= 2) throw new GenerationError("HTTP 429", true, 1, true);
        return { generationId: "gen-1", rateLimit: {} };
      },
      poll: async () => ({ state: "completed", outputUrl: OUTPUT }),
    };

    await drain(
      { ...deps(throttling), observe, sleep: async () => {} },
      { batchId: batch.id, maxSteps: 60 },
    );

    const throttles = events.filter((e) => e.throttled === true);
    expect(throttles.length).toBeGreaterThan(0);
    expect(throttles[0]!.stage).toBe("pending_submit");
  });
});

describe("how often a generation is asked about", () => {
  it("leaves a new generation alone before the first ask", async () => {
    // Measured: a generation takes about 93 seconds. Asking after three
    // produced 25 polls each and 728 requests for 30 finished photographs —
    // 24 in every 25 answered "still working", and none of it made anything
    // arrive sooner.
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    const slept: number[] = [];
    let polls = 0;
    const slow: ImageGenerator = {
      submit: async () => ({ generationId: `gen-${++polls}`, rateLimit: {} }),
      poll: async () => ({ state: "pending" }),
    };

    await drain(
      { ...deps(slow), sleep: async (ms) => void slept.push(ms) },
      { batchId: batch.id, maxSteps: 12 },
    );

    // The first wait is long because nothing has ever finished sooner.
    expect(Math.max(...slept)).toBeGreaterThanOrEqual(20_000);
  });

  it("polls far less than once a second for a batch in flight", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    let polls = 0;
    let elapsed = 0;
    const generator: ImageGenerator = {
      submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
      poll: async () => {
        polls += 1;
        // Finishes after roughly the measured 93 seconds.
        return elapsed >= 93_000
          ? { state: "completed", outputUrl: OUTPUT }
          : { state: "pending" };
      },
    };

    await drain(
      {
        ...deps(generator),
        sleep: async (ms) => {
          elapsed += ms;
        },
      },
      { batchId: batch.id, maxSteps: 400 },
    );

    // Three shots at ~93 seconds each. At the old three-second cadence this
    // was about 25 polls per generation; the backoff should roughly halve it.
    expect(polls).toBeLessThan(13 * 3);
  });

  it("still finishes the batch rather than waiting forever", async () => {
    const batch = await seed([{ sku: "HG-002", shotIdea: "kitchen" }]);
    await startGeneration(db, batch.id);

    let elapsed = 0;
    const generator: ImageGenerator = {
      submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
      poll: async () =>
        elapsed >= 20_000
          ? { state: "completed", outputUrl: OUTPUT }
          : { state: "pending" },
    };

    await drain(
      {
        ...deps(generator),
        sleep: async (ms) => {
          elapsed += ms;
        },
      },
      { batchId: batch.id, maxSteps: 400 },
    );

    const { images } = await getProductImages(db, batch.id, "HG-002");
    expect(images.every((i) => i.jobState === "posted")).toBe(true);
  });
});
