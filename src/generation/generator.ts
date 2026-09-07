import Luma from "luma-agents";
import type { ImageModel } from "../pricing.js";
import { noopObserver, type Observer } from "./observe.js";
import type { RateLimiter } from "./ratelimit.js";

/**
 * Async failure codes and whether retrying can help, taken from Luma's own
 * taxonomy rather than guessed. Retrying a moderated prompt burns money and
 * never succeeds; not retrying a transient model error throws away a shot that
 * would have worked.
 */
const RETRYABLE_FAILURE_CODES = new Set([
  "generation_failed",
  "output_not_found",
  "rate_limited",
]);

/** HTTP statuses where another attempt is worth making. */
const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

export interface RateLimit {
  limit?: number;
  remaining?: number;
  resetAtUnix?: number;
}

export interface SubmitInput {
  prompt: string;
  /** The product's own white-background photo. */
  sourceUrl: string;
  model: ImageModel;
  aspectRatio: string;
  /** Our image id, so Luma's usage records can be reconciled with ours. */
  userId: string;
}

export interface SubmitResult {
  generationId: string;
  rateLimit: RateLimit;
}

export type PollResult =
  | { state: "pending" }
  | { state: "completed"; outputUrl: string }
  | {
      state: "failed";
      failureCode: string | null;
      failureReason: string | null;
      retryable: boolean;
    };

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
    /**
     * The API refused because we were going too fast, not because anything is
     * wrong with this image.
     *
     * Kept separate from `retryable` because it changes who is at fault: a
     * throttled request must not spend one of the image's four attempts, or a
     * busy batch converts its own impatience into permanent failures.
     */
    readonly throttled: boolean = false,
  ) {
    super(message);
    this.name = "GenerationError";
  }
}

export interface ImageGenerator {
  submit(input: SubmitInput): Promise<SubmitResult>;
  poll(generationId: string): Promise<PollResult>;
}

type LumaLike = {
  generations: {
    create(body: Record<string, unknown>): {
      withResponse(): Promise<{ data: { id: string }; response: Response }>;
    };
    get(id: string): Promise<{
      state: string;
      output?: Array<{ url: string }>;
      failure_code?: string | null;
      failure_reason?: string | null;
    }>;
  };
};

function readRateLimit(response: Response): RateLimit {
  const num = (name: string) => {
    const raw = response.headers.get(name);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  return {
    limit: num("x-ratelimit-limit"),
    remaining: num("x-ratelimit-remaining"),
    resetAtUnix: num("x-ratelimit-reset"),
  };
}

export function createLumaGenerator(options: {
  authToken: string;
  client?: LumaLike;
  /** Paces requests against the window the API reports. */
  limiter?: RateLimiter;
  /** One structured line per call. */
  observe?: Observer;
  now?: () => number;
}): ImageGenerator {
  const client: LumaLike =
    options.client ?? (new Luma({ authToken: options.authToken }) as unknown as LumaLike);
  const limiter = options.limiter;
  const observe = options.observe ?? noopObserver;
  const now = options.now ?? (() => Date.now());

  return {
    async submit(input) {
      await limiter?.beforeCall();
      const startedAt = now();
      try {
        const { data, response } = await client.generations
          .create({
            type: "image_edit",
            prompt: input.prompt,
            source: { url: input.sourceUrl },
            model: input.model,
            aspect_ratio: input.aspectRatio,
            output_format: "jpeg",
            user_id: input.userId,
          })
          .withResponse();

        const rateLimit = readRateLimit(response);
        limiter?.observe(rateLimit);
        observe({
          event: "luma.call",
          op: "submit",
          outcome: "ok",
          imageId: input.userId,
          generationId: data.id,
          durationMs: now() - startedAt,
          rateLimitRemaining: rateLimit.remaining,
          rateLimitLimit: rateLimit.limit,
        });

        return { generationId: data.id, rateLimit };
      } catch (error) {
        const failure = toGenerationError(error);
        if (failure.throttled) limiter?.throttled(failure.retryAfterSeconds);
        observe({
          event: "luma.call",
          op: "submit",
          outcome: "error",
          imageId: input.userId,
          durationMs: now() - startedAt,
          status: (error as { status?: number }).status,
          retryable: failure.retryable,
          throttled: failure.throttled,
          message: failure.message,
        });
        throw failure;
      }
    },

    async poll(generationId) {
      await limiter?.beforeCall();
      const startedAt = now();
      let generation;
      try {
        generation = await client.generations.get(generationId);
      } catch (error) {
        const failure = toGenerationError(error);
        if (failure.throttled) limiter?.throttled(failure.retryAfterSeconds);
        observe({
          event: "luma.call",
          op: "poll",
          outcome: "error",
          generationId,
          durationMs: now() - startedAt,
          status: (error as { status?: number }).status,
          retryable: failure.retryable,
          throttled: failure.throttled,
          message: failure.message,
        });
        throw failure;
      }

      if (generation.state === "completed") {
        const url = generation.output?.[0]?.url;
        if (!url) {
          // Completed with nothing to fetch: treated as the retryable
          // output_not_found case rather than silently succeeding.
          observe({
            event: "luma.call",
            op: "poll",
            outcome: "failed",
            generationId,
            durationMs: now() - startedAt,
            failureCode: "output_not_found",
            failureReason: "completed with no output url",
            retryable: true,
          });
          return {
            state: "failed",
            failureCode: "output_not_found",
            failureReason: "completed with no output url",
            retryable: true,
          };
        }
        observe({
          event: "luma.call",
          op: "poll",
          outcome: "ok",
          generationId,
          durationMs: now() - startedAt,
        });
        return { state: "completed", outputUrl: url };
      }

      if (generation.state === "failed") {
        const code = generation.failure_code ?? null;
        const retryable = code !== null && RETRYABLE_FAILURE_CODES.has(code);
        // The one place that knows *why* a photograph never arrived. Logged
        // in full, because "the generation failed" in a Slack thread is not
        // something anyone can act on.
        observe({
          event: "luma.call",
          op: "poll",
          outcome: "failed",
          generationId,
          durationMs: now() - startedAt,
          failureCode: code,
          failureReason: generation.failure_reason ?? null,
          retryable,
        });
        return {
          state: "failed",
          failureCode: code,
          failureReason: generation.failure_reason ?? null,
          retryable,
        };
      }

      observe({
        event: "luma.call",
        op: "poll",
        outcome: "pending",
        generationId,
        durationMs: now() - startedAt,
      });
      return { state: "pending" };
    },
  };
}

function toGenerationError(error: unknown): GenerationError {
  const status = (error as { status?: number }).status;
  const headers = (error as { headers?: Record<string, string> }).headers;
  const message = (error as Error).message ?? "generation request failed";

  if (typeof status !== "number") {
    // A connection-level problem: worth another attempt.
    return new GenerationError(message, true);
  }

  const retryAfter = Number(headers?.["retry-after"]);
  return new GenerationError(
    `HTTP ${status}: ${message}`,
    RETRYABLE_STATUSES.has(status),
    Number.isFinite(retryAfter) ? retryAfter : undefined,
    status === 429,
  );
}
