import { describe, expect, it } from "vitest";
import { describeWait, estimateMinutes } from "./estimate.js";

describe("estimateMinutes", () => {
  it("is zero when there is nothing to do", () => {
    expect(estimateMinutes(0)).toBe(0);
  });

  it("never promises less than a minute for real work", () => {
    expect(estimateMinutes(1)).toBeGreaterThanOrEqual(1);
  });

  it("grows with the batch", () => {
    expect(estimateMinutes(72)).toBeGreaterThan(estimateMinutes(4));
  });

  it("puts the real catalog in a believable range", () => {
    // 48 generated plus 24 passed through.
    const minutes = estimateMinutes(72);
    expect(minutes).toBeGreaterThanOrEqual(4);
    expect(minutes).toBeLessThanOrEqual(8);
  });

  it("errs long rather than short", () => {
    // Being early is fine; being late sends someone looking for a bug.
    expect(estimateMinutes(72) * 60).toBeGreaterThan(72 * 3);
  });
});

describe("describeWait", () => {
  it("reads naturally for one minute", () => {
    expect(describeWait(1)).toBe("about a minute");
  });

  it("reads naturally for many", () => {
    expect(describeWait(72)).toMatch(/^about \d+ minutes$/);
  });
});
