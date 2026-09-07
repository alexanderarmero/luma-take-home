import { describe, expect, it, vi } from "vitest";
import { createLumaGenerator, GenerationError } from "./generator.js";

function generatorWith(client: unknown) {
  return createLumaGenerator({ authToken: "t", client: client as never });
}

/** Narrows a rejection to the error type, failing the test if it succeeded. */
async function expectGenerationError(
  promise: Promise<unknown>,
): Promise<GenerationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GenerationError) return error;
    throw error;
  }
  throw new Error("expected the call to reject");
}

function submitClient(id: string, headers: Record<string, string> = {}) {
  const create = vi.fn((_body: Record<string, unknown>) => ({
    withResponse: async () => ({
      data: { id },
      response: new Response(null, { headers }),
    }),
  }));
  return { create, client: { generations: { create, get: vi.fn() } } };
}

const SUBMIT = {
  prompt: "a mug on a sunlit kitchen counter",
  sourceUrl: "https://example.com/hg-002.jpg",
  model: "uni-1-max" as const,
  aspectRatio: "1:1",
  userId: "image-uuid",
};

describe("what the logs say about a call", () => {
  // Before this, a failure reached the channel as "the generation failed" and
  // the reason existed nowhere at all.
  function recording() {
    const events: Array<Record<string, unknown>> = [];
    return { events, observe: (e: Record<string, unknown>) => events.push(e) };
  }

  it("records why a generation was refused, with its code", async () => {
    const { events, observe } = recording();
    const generator = createLumaGenerator({
      authToken: "k",
      observe,
      client: {
        generations: {
          create: () => ({
            withResponse: async () => ({
              data: { id: "gen-1" },
              response: new Response(null, { headers: {} }),
            }),
          }),
          get: async () => ({
            state: "failed",
            failure_code: "content_moderated",
            failure_reason: "prompt rejected",
          }),
        },
      } as never,
    });

    await generator.poll("gen-1");

    const failure = events.find((e) => e.outcome === "failed")!;
    expect(failure.failureCode).toBe("content_moderated");
    expect(failure.failureReason).toBe("prompt rejected");
    expect(failure.generationId).toBe("gen-1");
    expect(typeof failure.durationMs).toBe("number");
  });

  it("records the rate-limit headroom on every submission", async () => {
    // "Why did those all fail?" and "how much room was left?" are usually the
    // same question.
    const { events, observe } = recording();
    const generator = createLumaGenerator({
      authToken: "k",
      observe,
      client: {
        generations: {
          create: () => ({
            withResponse: async () => ({
              data: { id: "gen-1" },
              response: new Response(null, {
                headers: { "x-ratelimit-limit": "30", "x-ratelimit-remaining": "4" },
              }),
            }),
          }),
          get: async () => ({ state: "queued" }),
        },
      } as never,
    });

    await generator.submit({
      prompt: "p",
      sourceUrl: "https://x.test/a.jpg",
      model: "uni-1-max",
      aspectRatio: "1:1",
      userId: "image-7",
    });

    const call = events[0]!;
    expect(call.op).toBe("submit");
    expect(call.rateLimitRemaining).toBe(4);
    expect(call.rateLimitLimit).toBe(30);
    // Traceable back to a product rather than only to a Luma id.
    expect(call.imageId).toBe("image-7");
  });
});

describe("submit", () => {
  it("edits the product's own photo rather than generating from scratch", async () => {
    const { create, client } = submitClient("gen-1");
    await generatorWith(client).submit(SUBMIT);

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "image_edit",
        source: { url: "https://example.com/hg-002.jpg" },
        model: "uni-1-max",
        aspect_ratio: "1:1",
      }),
    );
  });

  it("tags the request with our image id for later reconciliation", async () => {
    // The one defence against a crash between Luma accepting a request and us
    // persisting its id: the orphan is at least attributable.
    const { create, client } = submitClient("gen-1");
    await generatorWith(client).submit(SUBMIT);
    expect(create.mock.calls[0]![0]).toMatchObject({ user_id: "image-uuid" });
  });

  it("reads the rate-limit ceiling off the response", async () => {
    // The real limits are not published, so the only way to learn them is to
    // read what comes back.
    const { client } = submitClient("gen-1", {
      "x-ratelimit-limit": "30",
      "x-ratelimit-remaining": "17",
      "x-ratelimit-reset": "1712592060",
    });
    const result = await generatorWith(client).submit(SUBMIT);
    expect(result.rateLimit).toEqual({
      limit: 30,
      remaining: 17,
      resetAtUnix: 1712592060,
    });
  });

  it("copes with a response carrying no rate-limit headers", async () => {
    const { client } = submitClient("gen-1");
    const result = await generatorWith(client).submit(SUBMIT);
    expect(result.rateLimit).toEqual({});
  });

  it("marks a rate-limited submission retryable and keeps the wait", async () => {
    const client = {
      generations: {
        create: () => ({
          withResponse: async () => {
            throw Object.assign(new Error("Rate limit exceeded"), {
              status: 429,
              headers: { "retry-after": "12" },
            });
          },
        }),
        get: vi.fn(),
      },
    };

    const error = await expectGenerationError(generatorWith(client).submit(SUBMIT));
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSeconds).toBe(12);
  });

  it("does not retry a request the API rejected as invalid", async () => {
    const client = {
      generations: {
        create: () => ({
          withResponse: async () => {
            throw Object.assign(new Error("bad params"), { status: 400 });
          },
        }),
        get: vi.fn(),
      },
    };
    const error = await expectGenerationError(generatorWith(client).submit(SUBMIT));
    expect(error.retryable).toBe(false);
  });

  it("treats a connection failure as worth another attempt", async () => {
    const client = {
      generations: {
        create: () => ({
          withResponse: async () => {
            throw new Error("socket hang up");
          },
        }),
        get: vi.fn(),
      },
    };
    const error = await expectGenerationError(generatorWith(client).submit(SUBMIT));
    expect(error.retryable).toBe(true);
  });
});

describe("poll", () => {
  const pollClient = (generation: unknown) => ({
    generations: { create: vi.fn(), get: async () => generation },
  });

  it("reports a job still running as pending", async () => {
    const result = await generatorWith(pollClient({ state: "processing" })).poll("g");
    expect(result).toEqual({ state: "pending" });
  });

  it("returns the output url on completion", async () => {
    const result = await generatorWith(
      pollClient({ state: "completed", output: [{ url: "https://s3/out.jpg" }] }),
    ).poll("g");
    expect(result).toEqual({ state: "completed", outputUrl: "https://s3/out.jpg" });
  });

  it("does not call a completion with no output a success", async () => {
    const result = await generatorWith(pollClient({ state: "completed", output: [] })).poll("g");
    expect(result).toMatchObject({
      state: "failed",
      failureCode: "output_not_found",
      retryable: true,
    });
  });

  it("marks a moderated prompt as not worth retrying", async () => {
    // Retrying it burns money and can never succeed.
    const result = await generatorWith(
      pollClient({
        state: "failed",
        failure_code: "content_moderated",
        failure_reason: "policy",
      }),
    ).poll("g");
    expect(result).toMatchObject({ state: "failed", retryable: false });
  });

  it("marks a transient model error as worth retrying", async () => {
    const result = await generatorWith(
      pollClient({ state: "failed", failure_code: "generation_failed" }),
    ).poll("g");
    expect(result).toMatchObject({ state: "failed", retryable: true });
  });

  it.each([
    "budget_exhausted",
    "image_too_large",
    "unsupported_format",
    "corrupt_input",
    "invalid_request",
  ])("does not retry %s", async (code) => {
    const result = await generatorWith(
      pollClient({ state: "failed", failure_code: code }),
    ).poll("g");
    expect(result).toMatchObject({ retryable: false });
  });
});
