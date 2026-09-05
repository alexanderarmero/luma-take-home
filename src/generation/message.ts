import type { ProductImage } from "../db/repository.js";
import type { Block } from "../slack/client.js";

/** Why a candidate never arrived, in words the team can act on. */
const FAILURE_REASONS: Record<string, string> = {
  content_moderated: "the prompt or the photo tripped the content filter",
  image_too_large: "the source photo was too large",
  unsupported_format: "the source photo was in a format the model can't read",
  corrupt_input: "the source photo couldn't be decoded",
  budget_exhausted: "the account ran out of credit",
  invalid_request: "the request was rejected as invalid",
};

export function explainFailure(failureCode: string | null): string {
  if (!failureCode) return "the generation failed";
  return FAILURE_REASONS[failureCode] ?? `the generation failed (${failureCode})`;
}

export interface ProductChannelInput {
  sku: string;
  productName: string;
  shotIdea: string | null;
  images: ProductImage[];
  /** Deep link into the overview page, anchored at this product. */
  reviewUrl?: string;
}

/**
 * The product's line in the channel. Deliberately text only.
 *
 * The channel is for finding things: forty scannable lines you can search by
 * SKU and skim on a phone, rather than forty screens of photographs. The
 * images live in this message's thread, which is also where the conversation
 * about them belongs — "that one, not the others" is a comparison across a
 * product's candidates, so the product is the right grain for both.
 */
export function buildProductChannelMessage(input: ProductChannelInput): {
  text: string;
  blocks: Block[];
} {
  const { sku, productName, shotIdea, images, reviewUrl } = input;

  const usable = images.filter((i) => i.jobState !== "failed");
  const failed = images.filter((i) => i.jobState === "failed");
  const isPassThrough = images.some((i) => i.kind === "pass_through");
  const decided = images.filter((i) => i.decision != null).length;

  const subtitle = isPassThrough
    ? "_No shot idea was given, so this is the original photo, unchanged._"
    : `_"${shotIdea ?? ""}"_`;

  const counts: string[] = [
    `${usable.length} ${usable.length === 1 ? "photo" : "photos"}`,
  ];
  counts.push(
    decided === 0
      ? "none decided yet"
      : decided === usable.length
        ? "all decided"
        : `${decided} of ${usable.length} decided`,
  );
  if (failed.length > 0) {
    counts.push(`${failed.length} couldn't be generated`);
  }

  const text = `${sku} · ${productName}`;

  return {
    text,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${sku} · ${productName}*\n${subtitle}`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text:
              `${counts.join(" · ")} — photos are in this thread.` +
              (reviewUrl ? ` <${reviewUrl}|Review on the overview page>` : ""),
          },
        ],
      },
    ],
  };
}

/**
 * One candidate, posted into the product's thread as its own file share so the
 * bytes live in Slack and the decision sits directly under the image it is
 * about.
 */
export function buildCandidateBlocks(image: ProductImage): Block[] {
  const blocks: Block[] = [];

  if (image.prompt) {
    // Small grey text: visible, and not competing with the photograph.
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: image.prompt }],
    });
  }

  // Its outcome, once there is one. Deciding happens on the overview page,
  // where the whole set is visible at once — the thread is for talking about a
  // shot, and reads better without a control on every photograph.
  if (image.decision) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            image.decision === "approved"
              ? ":white_check_mark: *Approved*"
              : ":x: *Discarded*",
        },
      ],
    });
  }

  return blocks;
}

/** Note posted into the thread for candidates that never arrived. */
export function buildFailureNote(failed: ProductImage[], total: number): Block[] {
  const reasons = [...new Set(failed.map((f) => explainFailure(f.failureCode)))];
  return [
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            `:warning: ${failed.length} of ${total} couldn't be generated — ` +
            `${reasons.join("; ")}.`,
        },
      ],
    },
  ];
}
