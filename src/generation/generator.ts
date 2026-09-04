import Luma from "luma-agents";
import type { ImageModel } from "../pricing.js";

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
}): ImageGenerator {
  const client: LumaLike =
    options.client ?? (new Luma({ authToken: options.authToken }) as unknown as LumaLike);

  return {
    async submit(input) {
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

        return { generationId: data.id, rateLimit: readRateLimit(response) };
      } catch (error) {
        throw toGenerationError(error);
      }
    },

    async poll(generationId) {
      let generation;
      try {
        generation = await client.generations.get(generationId);
      } catch (error) {
        throw toGenerationError(error);
      }

      if (generation.state === "completed") {
        const url = generation.output?.[0]?.url;
        if (!url) {
          // Completed with nothing to fetch: treated as the retryable
          // output_not_found case rather than silently succeeding.
          return {
            state: "failed",
            failureCode: "output_not_found",
            failureReason: "completed with no output url",
            retryable: true,
          };
        }
        return { state: "completed", outputUrl: url };
      }

      if (generation.state === "failed") {
        const code = generation.failure_code ?? null;
        return {
          state: "failed",
          failureCode: code,
          failureReason: generation.failure_reason ?? null,
          retryable: code !== null && RETRYABLE_FAILURE_CODES.has(code),
        };
      }

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
  );
}
