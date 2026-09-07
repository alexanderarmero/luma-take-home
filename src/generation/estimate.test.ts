import { describe, expect, it } from "vitest";
import { describeWait, estimateMinutes } from "./estimate.js";

/** The real catalog: sixteen products with a shot idea, eight without. */
const CATALOG = { styled: 48, passThrough: 24 };

describe("estimateMinutes", () => {
  it("is zero when there is nothing to do", () => {
    expect(estimateMinutes({ styled: 0, passThrough: 0 })).toBe(0);
  });

  it("never promises less than a minute for real work", () => {
    expect(estimateMinutes({ styled: 1, passThrough: 0 })).toBeGreaterThanOrEqual(1);
    expect(estimateMinutes({ styled: 0, passThrough: 1 })).toBeGreaterThanOrEqual(1);
  });

  it("grows with the batch", () => {
    expect(estimateMinutes(CATALOG)).toBeGreaterThan(
      estimateMinutes({ styled: 3, passThrough: 1 }),
    );
  });

  it("counts generations in waves of three, not all at once", () => {
    // The bug this file exists to prevent. Three styled photos fit in one
    // wave; six need two, and must therefore be meaningfully slower. An
    // estimate that assumed unbounded upstream concurrency could not tell
    // these apart.
    const oneWave = estimateMinutes({ styled: 3, passThrough: 0 });
    const fourWaves = estimateMinutes({ styled: 12, passThrough: 0 });
    expect(fourWaves).toBeGreaterThanOrEqual(oneWave * 3);
  });

  it("does not charge a pass-through for capacity it never uses", () => {
    // A copied original makes no Luma call and waits on no slot, so a batch of
    // them is quick. Counting it as a generation is what inflated the old
    // number on every mixed batch.
    expect(estimateMinutes({ styled: 0, passThrough: 24 })).toBeLessThan(
      estimateMinutes({ styled: 24, passThrough: 0 }),
    );
  });

  it("respects a capacity the account does not actually have", () => {
    // `LUMA_MAX_CONCURRENT` can move the worker's ceiling, and the promise
    // made to the channel has to move with it or it is a lie again.
    const atThree = estimateMinutes(CATALOG, 3);
    const atOne = estimateMinutes(CATALOG, 1);
    expect(atOne).toBeGreaterThan(atThree);
  });

  it("puts the real catalog in a believable range", () => {
    // Sixteen waves at a measured 93 seconds, plus local work on seventy-two
    // images. The previous model said five minutes here, which was the defect;
    // F16.5 puts the generation half alone at about twenty-five.
    const minutes = estimateMinutes(CATALOG);
    expect(minutes).toBeGreaterThanOrEqual(25);
    expect(minutes).toBeLessThanOrEqual(38);
  });

  it("errs long rather than short", () => {
    // Being early is fine; being late sends someone looking for a bug. The
    // floor is the generation waves alone, before any local work is counted.
    const seconds = estimateMinutes(CATALOG) * 60;
    expect(seconds).toBeGreaterThan(Math.ceil(CATALOG.styled / 3) * 93);
  });
});

describe("describeWait", () => {
  it("reads naturally for one minute", () => {
    expect(describeWait({ styled: 0, passThrough: 1 })).toBe("about a minute");
  });

  it("reads naturally for many", () => {
    expect(describeWait(CATALOG)).toMatch(/^about \d+ minutes$/);
  });
});
