import type { ProductImage } from "../db/repository.js";
import type { Block } from "../slack/client.js";

export const APPROVE_ACTION_ID = "approve_image";
export const DISCARD_ACTION_ID = "discard_image";

/** Why a candidate never arrived, in words the team can act on. */
const FAILURE_REASONS: Record<string, string> = {
  content_moderated: "the prompt or the photo tripped the content filter",
  image_too_large: "the source photo was too large",
  unsupported_format: "the source photo was in a format the model can't read",
  corrupt_input: "the source photo couldn't be decoded",
  budget_exhausted: "the account ran out of credit",
  invalid_request: "the request was rejected as invalid",
};

export interface ProductMessageInput {
  sku: string;
  productName: string;
  shotIdea: string | null;
  images: ProductImage[];
  /** Where Slack fetches the images from — the deployed service's own URL. */
  publicBaseUrl: string;
}

function imageUrl(baseUrl: string, objectKey: string): string {
  // Object keys look like `images/<uuid>.jpg`; the route takes the uuid.
  const id = objectKey.replace(/^images\//, "").replace(/\.jpg$/, "");
  return `${baseUrl}/img/${id}`;
}

/**
 * One message per product, carrying every candidate with its own decision.
 *
 * Grouping them is what makes the choice a comparison rather than a sequence:
 * the alternatives are in front of the reviewer at once, and a button sits
 * under the image it belongs to rather than being matched to it by a label.
 */
export function buildProductMessage(input: ProductMessageInput): {
  text: string;
  blocks: Block[];
} {
  const { sku, productName, shotIdea, images, publicBaseUrl } = input;

  const posted = images.filter((i) => i.objectKey !== null && i.jobState !== "failed");
  const failed = images.filter((i) => i.jobState === "failed");
  const isPassThrough = images.some((i) => i.kind === "pass_through");

  const heading = isPassThrough
    ? `*${sku} · ${productName}*\n_No shot idea was given, so this is the original ` +
      `photo, unchanged._`
    : `*${sku} · ${productName}*\n_"${shotIdea ?? ""}"_`;

  const blocks: Block[] = [
    { type: "section", text: { type: "mrkdwn", text: heading } },
  ];

  for (const image of posted) {
    blocks.push({
      type: "image",
      image_url: imageUrl(publicBaseUrl, image.objectKey!),
      alt_text: `${productName} — ${image.filename}`,
      title: { type: "plain_text", text: image.filename },
    });

    if (image.prompt) {
      // A context block keeps the prompt readable without letting it compete
      // with the image it explains.
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: image.prompt }],
      });
    }

    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: APPROVE_ACTION_ID,
          text: { type: "plain_text", text: "Approve", emoji: true },
          style: "primary",
          value: image.imageId,
        },
        {
          type: "button",
          action_id: DISCARD_ACTION_ID,
          text: { type: "plain_text", text: "Discard", emoji: true },
          value: image.imageId,
        },
      ],
    });
  }

  // Said outright. A candidate that silently never appears is indistinguishable
  // from one still on its way, and the reviewer would keep waiting for it.
  if (failed.length > 0) {
    const reasons = [...new Set(failed.map((f) => explain(f.failureCode)))];
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text:
            `:warning: ${failed.length} of ${images.length} couldn't be generated — ` +
            `${reasons.join("; ")}.`,
        },
      ],
    });
  }

  return { text: `${sku} · ${productName}`, blocks };
}

function explain(failureCode: string | null): string {
  if (!failureCode) return "the generation failed";
  return FAILURE_REASONS[failureCode] ?? `the generation failed (${failureCode})`;
}
