import { describe, expect, it } from "vitest";
import { buildFilename, slugifyShotIdea } from "./filename.js";

describe("slugifyShotIdea", () => {
  it("turns a shot idea into a readable slug", () => {
    expect(slugifyShotIdea("morning kitchen counter, steam, warm light")).toBe(
      "morning-kitchen-counter-steam",
    );
  });

  it("drops punctuation a filename should not carry", () => {
    expect(slugifyShotIdea("holiday table close-up!")).toBe("holiday-table-close-up");
  });

  it("keeps the meaningful words when stopwords would crowd them out", () => {
    // "on-a-set-dinner" would tell the web person nothing about the photo.
    expect(slugifyShotIdea("on a set dinner table, with food in it?")).toBe(
      "set-dinner-table-food",
    );
  });

  it("keeps a shot idea that is mostly stopwords rather than gutting it", () => {
    expect(slugifyShotIdea("in the it")).toBe("in-the-it");
  });

  it("collapses runs of separators rather than leaving gaps", () => {
    expect(slugifyShotIdea("holiday  --  mantel")).toBe("holiday-mantel");
  });

  it("never ends on a separator", () => {
    expect(slugifyShotIdea("cosy shelf corner, lamp actually lit")).not.toMatch(/-$/);
  });

  it("falls back to a fixed word rather than an empty slug", () => {
    expect(slugifyShotIdea("!!! ???")).toBe("shot");
    expect(slugifyShotIdea("")).toBe("shot");
  });

  it("handles accents without emitting them", () => {
    expect(slugifyShotIdea("café table, soft light")).toBe("cafe-table-soft-light");
  });
});

describe("buildFilename", () => {
  it("names a styled shot by SKU, idea and slot", () => {
    expect(
      buildFilename({
        sku: "HG-002",
        slot: 1,
        shotIdea: "morning kitchen counter, steam, warm light",
      }),
    ).toBe("HG-002_morning-kitchen-counter-steam_01.jpg");
  });

  it("pads the slot so files sort in order past nine", () => {
    const tenth = buildFilename({ sku: "HG-002", slot: 10, shotIdea: "x y" });
    expect(tenth).toContain("_10.jpg");
  });

  it("marks a pass-through as the original, so nobody has to guess", () => {
    // The web person must never wonder whether a photo was modified.
    expect(buildFilename({ sku: "HG-001", slot: 1, shotIdea: null })).toBe(
      "HG-001_original.jpg",
    );
  });

  it("is deterministic — the same row always yields the same name", () => {
    const args = { sku: "HG-005", slot: 2, shotIdea: "on a set dinner table" };
    expect(buildFilename(args)).toBe(buildFilename(args));
  });

  it("keeps names distinct across slots of the same product", () => {
    const idea = "holiday mantel with evergreen";
    const names = [1, 2, 3].map((slot) =>
      buildFilename({ sku: "HG-025", slot, shotIdea: idea }),
    );
    expect(new Set(names).size).toBe(3);
  });

  it("produces something safe for a zip and a URL", () => {
    const name = buildFilename({
      sku: "HG-041",
      slot: 1,
      shotIdea: "iced drinks on a patio table",
    });
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
