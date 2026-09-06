import { describe, expect, it } from "vitest";
import type { ProductImage } from "../db/repository.js";
import {
  buildCandidateBlocks,
  buildFailureNote,
  buildProductChannelMessage,
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
    expect(json(blocks)).toContain("1 didn't arrive");
  });

  it("points the reader at the thread and at the page", () => {
    const { blocks } = buildProductChannelMessage({
      sku: "HG-002",
      productName: "Stoneware Mug 12oz",
      shotIdea: "morning kitchen counter",
      images: [candidate(1)],
      reviewUrl: "https://shots.test/review/abc#p-HG-002",
    });
    const text = json(blocks);
    expect(text).toContain("in this thread");
    expect(text).toContain("https://shots.test/review/abc#p-HG-002");
  });

  it("omits the page link when the service does not know its own address", () => {
    expect(json(channel([candidate(1)]).blocks)).not.toContain("Review on the overview");
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
  it("carries no controls, because deciding happens on the page", () => {
    const blocks = buildCandidateBlocks(candidate(2));
    expect(blocks.some((b) => (b as { type: string }).type === "actions")).toBe(false);
  });

  it("shows its outcome once decided", () => {
    const blocks = buildCandidateBlocks(candidate(2, { decision: "approved" }));
    expect(JSON.stringify(blocks)).toContain("Approved");
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

describe("a pass-through that never arrived", () => {
  // Nothing is generated for a product with no shot idea — its own photo is
  // copied. Saying "the generation failed" sends the reader looking for a
  // prompt problem that cannot exist, and these failures carry no Luma
  // failure code, so the default wording was wrong twice over.
  it("says the photo could not be copied, not generated", () => {
    const text = explainFailure(null, { kind: "pass_through" });
    expect(text).toContain("original photo couldn't be copied");
    expect(text).not.toContain("generat");
  });

  it("carries the real error, because this one is ours to fix", () => {
    const text = explainFailure(null, {
      kind: "pass_through",
      lastError: "download failed: HTTP 403",
    });
    expect(text).toContain("HTTP 403");
  });

  it("still explains a generated image by its Luma code", () => {
    expect(explainFailure("content_moderated", { kind: "styled" })).toContain(
      "content filter",
    );
  });

  it("surfaces the underlying error when a generation has no code either", () => {
    expect(
      explainFailure(null, { kind: "styled", lastError: "socket hang up" }),
    ).toContain("socket hang up");
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
