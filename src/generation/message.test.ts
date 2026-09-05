import { describe, expect, it } from "vitest";
import type { ProductImage } from "../db/repository.js";
import { APPROVE_ACTION_ID, buildProductMessage, DISCARD_ACTION_ID } from "./message.js";

const BASE = "https://shots.test";

function candidate(slot: number, overrides: Partial<ProductImage> = {}): ProductImage {
  return {
    imageId: `image-${slot}`,
    slot,
    filename: `HG-002_morning-kitchen_0${slot}.jpg`,
    prompt: "a stoneware mug on a sunlit kitchen counter",
    kind: "styled",
    objectKey: `images/uuid-${slot}.jpg`,
    jobState: "stored",
    failureCode: null,
    ...overrides,
  };
}

function build(images: ProductImage[], shotIdea: string | null = "morning kitchen counter") {
  return buildProductMessage({
    sku: "HG-002",
    productName: "Stoneware Mug 12oz",
    shotIdea,
    images,
    publicBaseUrl: BASE,
  });
}

const typesOf = (blocks: unknown[]) =>
  blocks.map((b) => (b as { type: string }).type);

describe("buildProductMessage", () => {
  it("puts every candidate in one message", () => {
    const { blocks } = build([candidate(1), candidate(2), candidate(3)]);
    expect(typesOf(blocks).filter((t) => t === "image")).toHaveLength(3);
  });

  it("puts a decision under each image, not one for the message", () => {
    // The whole reason for batching: a button beside the image it belongs to,
    // rather than a row of buttons matched to images by a label.
    const { blocks } = build([candidate(1), candidate(2)]);
    expect(typesOf(blocks)).toEqual([
      "section",
      "image",
      "context",
      "actions",
      "image",
      "context",
      "actions",
    ]);
  });

  it("carries the image's own id on its buttons", () => {
    const { blocks } = build([candidate(1), candidate(2)]);
    const actions = blocks.filter((b) => (b as { type: string }).type === "actions");
    const values = actions.map(
      (b) => ((b as { elements: Array<{ value: string }> }).elements[0]!).value,
    );
    expect(values).toEqual(["image-1", "image-2"]);
  });

  it("offers both an approve and a discard for each", () => {
    const { blocks } = build([candidate(1)]);
    const actions = blocks.find((b) => (b as { type: string }).type === "actions");
    const ids = (actions as { elements: Array<{ action_id: string }> }).elements.map(
      (e) => e.action_id,
    );
    expect(ids).toEqual([APPROVE_ACTION_ID, DISCARD_ACTION_ID]);
  });

  it("points images at our own serving route", () => {
    const { blocks } = build([candidate(1)]);
    const image = blocks.find((b) => (b as { type: string }).type === "image");
    expect((image as { image_url: string }).image_url).toBe(`${BASE}/img/uuid-1`);
  });

  it("titles each image with its filename, so the name is visible where the decision is", () => {
    const { blocks } = build([candidate(1)]);
    const image = blocks.find((b) => (b as { type: string }).type === "image");
    expect((image as { title: { text: string } }).title.text).toBe(
      "HG-002_morning-kitchen_01.jpg",
    );
  });

  it("shows the shot idea the team wrote", () => {
    const { blocks } = build([candidate(1)]);
    expect(JSON.stringify(blocks[0])).toContain("morning kitchen counter");
  });

  it("shows the prompt that produced each image", () => {
    const { blocks } = build([candidate(1)]);
    expect(JSON.stringify(blocks)).toContain("sunlit kitchen counter");
  });

  it("says outright that a pass-through was not changed", () => {
    const { blocks } = build(
      [candidate(1, { kind: "pass_through", prompt: null, filename: "HG-002_original.jpg" })],
      null,
    );
    const heading = JSON.stringify(blocks[0]);
    expect(heading).toContain("No shot idea was given");
    expect(heading).toContain("unchanged");
  });

  it("explains a candidate that could not be generated", () => {
    // A candidate that silently never appears is indistinguishable from one
    // still on its way, and the reviewer would keep waiting for it.
    const { blocks } = build([
      candidate(1),
      candidate(2, { jobState: "failed", objectKey: null, failureCode: "content_moderated" }),
      candidate(3),
    ]);

    expect(typesOf(blocks).filter((t) => t === "image")).toHaveLength(2);
    const text = JSON.stringify(blocks);
    expect(text).toContain("1 of 3 couldn't be generated");
    expect(text).toContain("content filter");
  });

  it("does not mention failures when there were none", () => {
    const { blocks } = build([candidate(1), candidate(2)]);
    expect(JSON.stringify(blocks)).not.toContain("couldn't be generated");
  });

  it("names an unfamiliar failure code rather than staying vague", () => {
    const { blocks } = build([
      candidate(1, { jobState: "failed", objectKey: null, failureCode: "something_new" }),
      candidate(2),
    ]);
    expect(JSON.stringify(blocks)).toContain("something_new");
  });

  it("gives every image an alt_text", () => {
    // Slack rejects the whole message otherwise, and says only
    // `invalid_blocks` — which cost three attempts to diagnose once already.
    const { blocks } = build([candidate(1), candidate(2), candidate(3)]);
    for (const block of blocks.filter((b) => (b as { type: string }).type === "image")) {
      expect((block as { alt_text: string }).alt_text).toBeTruthy();
    }
  });

  it("emits nothing undefined, which Slack rejects outright", () => {
    const { blocks } = build([
      candidate(1, { prompt: null }),
      candidate(2, { jobState: "failed", objectKey: null, failureCode: null }),
    ]);
    expect(JSON.stringify(blocks)).not.toContain("undefined");
    expect(JSON.stringify(blocks)).not.toContain('""');
  });

  it("stays well inside Slack's block ceiling at the largest product", () => {
    const { blocks } = build([candidate(1), candidate(2), candidate(3)]);
    expect(blocks.length).toBeLessThan(50);
  });

  it("uses the SKU and product name as the message fallback text", () => {
    const { text } = build([candidate(1)]);
    expect(text).toBe("HG-002 · Stoneware Mug 12oz");
  });
});
