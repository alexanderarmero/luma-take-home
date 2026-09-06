import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, type BrandContext } from "./brand.js";

export interface PromptRequest {
  shotIdea: string;
  sku: string;
  productName: string;
  category: string;
  colour: string;
  material: string;
  count: number;
}

export interface PromptWriter {
  write(request: PromptRequest): Promise<string[]>;
}

const MODEL = "claude-opus-5";

const SCHEMA = {
  type: "object",
  properties: {
    prompts: {
      type: "array",
      items: { type: "string" },
      description: "One prompt per candidate, each a different reading of the shot idea.",
    },
  },
  required: ["prompts"],
  additionalProperties: false,
} as const;

type MessagesLike = {
  parse(params: Record<string, unknown>): Promise<{
    parsed_output?: { prompts?: unknown } | null;
  }>;
};

export interface PromptWriterOptions {
  apiKey: string;
  brand: BrandContext;
  /** Overrides the built-in direction; the brand block is never replaceable. */
  direction?: string;
  /** Injectable so the wiring is testable without calling the API. */
  messages?: MessagesLike;
}

export function createPromptWriter(options: PromptWriterOptions): PromptWriter {
  const messages =
    options.messages ??
    (new Anthropic({ apiKey: options.apiKey }).messages as unknown as MessagesLike);

  const system = buildSystemPrompt(options.brand, options.direction);

  return {
    async write(request) {
      const result = await messages.parse({
        model: MODEL,
        max_tokens: 1024,
        // The brand half never varies across a batch, so it caches; the product
        // half is the only thing that changes between calls.
        system: [
          { type: "text", text: system, cache_control: { type: "ephemeral" } },
        ],
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: SCHEMA },
        },
        messages: [
          {
            role: "user",
            content: [
              `Product: ${request.productName} (${request.sku})`,
              `Category: ${request.category}`,
              `Colour / finish: ${request.colour}`,
              `Material: ${request.material}`,
              `Shot idea: "${request.shotIdea}"`,
              "",
              `Write exactly ${request.count} prompts.`,
            ].join("\n"),
          },
        ],
      });

      const prompts = result.parsed_output?.prompts;
      if (!Array.isArray(prompts) || prompts.length === 0) {
        throw new Error("prompt writer returned no prompts");
      }

      const cleaned = prompts
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .map((p) => p.trim());

      if (cleaned.length === 0) throw new Error("prompt writer returned no usable prompts");

      // Pad by repeating rather than failing: three candidates from two good
      // prompts is better than none from a short answer.
      while (cleaned.length < request.count) {
        cleaned.push(cleaned[cleaned.length % cleaned.length]!);
      }
      return cleaned.slice(0, request.count);
    },
  };
}

/**
 * What to use when translation is unavailable or fails.
 *
 * The shot idea unchanged. Worse prompts, but a batch that runs — a hiccup in
 * translation must not be able to stop the pipeline.
 */
export function fallbackPrompts(shotIdea: string, count: number): string[] {
  return Array.from({ length: count }, () => shotIdea);
}
