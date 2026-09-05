import { describe, expect, it } from "vitest";
import type { ProductImage } from "../db/repository.js";
import {
  APPROVE_ACTION_ID,
  buildCandidateBlocks,
  buildFailureNote,
  buildProductChannelMessage,
  DISCARD_ACTION_ID,
  explainFailure,
} from "./message.js";

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
    decision: null,
    ...overrides,
  };
}

const channel = (images: ProductImage[], shotIdea: string | null = "morning kitchen counter") =>
  buildProductChannelMessage({
    sku: "HG-002",
    productName: "Stoneware Mug 12oz",
    shotIdea,
    images,
  });

const json = (value: unknown) => JSON.stringify(value);

describe("the product's line in the channel", () => {
  it("carries no images, so the channel stays scannable", () => {
    // The channel is for finding things. Forty screens of photographs is not
    // something you skim on a phone.
    const { blocks } = channel([candidate(1), candidate(2), candidate(3)]);
    expect(json(blocks)).not.toContain('"image"');
    expect(json(blocks)).not.toContain("image_url");
  });

  it("leads with the SKU and product name, so it can be searched", () => {
    const { text, blocks } = channel([candidate(1)]);
    expect(text).toBe("HG-002 · Stoneware Mug 12oz");
    expect(json(blocks[0])).toContain("HG-002 · Stoneware Mug 12oz");
  });

  it("shows the shot idea the team wrote", () => {
    expect(json(channel([candidate(1)]).blocks)).toContain("morning kitchen counter");
  });

  it("says how many photos and how many are decided", () => {
    // This is what makes the channel a work queue rather than an index.
    const { blocks } = channel([candidate(1), candidate(2), candidate(3)]);
    expect(json(blocks)).toContain("3 photos");
    expect(json(blocks)).toContain("none decided yet");
  });

  it("counts partial progress", () => {
    const { blocks } = channel([
      candidate(1, { decision: "approved" }),
      candidate(2),
      candidate(3),
    ]);
    expect(json(blocks)).toContain("1 of 3 decided");
  });

  it("says so when a product is finished", () => {
    const { blocks } = channel([
      candidate(1, { decision: "approved" }),
      candidate(2, { decision: "discarded" }),
    ]);
    expect(json(blocks)).toContain("all decided");
  });

  it("names photos that could not be generated, and leaves them out of the count", () => {
    const { blocks } = channel([
      candidate(1),
      candidate(2, { jobState: "failed", objectKey: null, failureCode: "content_moderated" }),
      candidate(3),
    ]);
    expect(json(blocks)).toContain("2 photos");
    expect(json(blocks)).toContain("1 couldn't be generated");
  });

  it("points the reader at the thread", () => {
    expect(json(channel([candidate(1)]).blocks)).toContain("open the thread");
  });

  it("says outright when a photo is the unchanged original", () => {
    const { blocks } = channel(
      [candidate(1, { kind: "pass_through", prompt: null })],
      null,
    );
    expect(json(blocks)).toContain("No shot idea was given");
    expect(json(blocks)).toContain("unchanged");
  });

  it("gets the singular right for one photo", () => {
    expect(json(channel([candidate(1)]).blocks)).toContain("1 photo ");
  });
});

describe("a candidate in the thread", () => {
  it("offers an approve and a discard carrying that image's own id", () => {
    const blocks = buildCandidateBlocks(candidate(2));
    const actions = blocks.find((b) => (b as { type: string }).type === "actions");
    const elements = (actions as { elements: Array<{ action_id: string; value: string }> })
      .elements;

    expect(elements.map((e) => e.action_id)).toEqual([
      APPROVE_ACTION_ID,
      DISCARD_ACTION_ID,
    ]);
    expect(elements.every((e) => e.value === "image-2")).toBe(true);
  });

  it("shows the prompt that produced it", () => {
    expect(json(buildCandidateBlocks(candidate(1)))).toContain("sunlit kitchen counter");
  });

  it("omits the prompt for a pass-through, which had none", () => {
    const blocks = buildCandidateBlocks(candidate(1, { kind: "pass_through", prompt: null }));
    expect(blocks.filter((b) => (b as { type: string }).type === "context")).toHaveLength(0);
  });

  it("emits nothing Slack would reject", () => {
    // A single malformed block takes down the whole message, and the error
    // names only the message.
    const blocks = buildCandidateBlocks(candidate(1, { prompt: null }));
    expect(json(blocks)).not.toContain("undefined");
    expect(json(blocks)).not.toContain('""');
  });
});

describe("failure notes", () => {
  it("says how many and why, in words", () => {
    const blocks = buildFailureNote(
      [candidate(2, { jobState: "failed", failureCode: "content_moderated" })],
      3,
    );
    expect(json(blocks)).toContain("1 of 3");
    expect(json(blocks)).toContain("content filter");
  });

  it("does not repeat the same reason twice", () => {
    const failed = [
      candidate(1, { jobState: "failed", failureCode: "content_moderated" }),
      candidate(2, { jobState: "failed", failureCode: "content_moderated" }),
    ];
    const text = json(buildFailureNote(failed, 3));
    expect(text.match(/content filter/g)).toHaveLength(1);
  });

  it("names an unfamiliar code rather than staying vague", () => {
    expect(explainFailure("something_new")).toContain("something_new");
  });

  it("copes with no code at all", () => {
    expect(explainFailure(null)).toBe("the generation failed");
  });
});
