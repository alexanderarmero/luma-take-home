import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalog } from "./parse.js";
import { buildRecap, planBatch } from "./recap.js";

const REAL = readFileSync("data/catalog.csv", "utf8");

function realRows() {
  const parsed = parseCatalog(REAL);
  if (!parsed.ok) throw new Error("fixture should parse");
  return parsed;
}

describe("planBatch — against the real catalog", () => {
  it("styles the rows that carry a shot idea and passes the rest through", () => {
    const plan = planBatch(realRows().rows);
    expect(plan.totalRows).toBe(40);
    expect(plan.rowsWithShotIdea).toBe(16);
    expect(plan.rowsWithoutShotIdea).toBe(24);
  });

  it("generates candidates only for rows with a shot idea", () => {
    const plan = planBatch(realRows().rows);
    expect(plan.imagesToGenerate).toBe(16 * 3);
    expect(plan.passThroughImages).toBe(24);
    expect(plan.totalImagesToReview).toBe(48 + 24);
  });

  it("charges nothing for a pass-through", () => {
    const onlyBlanks = realRows().rows.filter((r) => r.shotIdea === null);
    const plan = planBatch(onlyBlanks);
    expect(plan.imagesToGenerate).toBe(0);
    expect(plan.estimatedCostUsd).toBe(0);
  });

  it("prices the real catalog at roughly five dollars", () => {
    const plan = planBatch(realRows().rows);
    // 48 edits at $0.1030 plus prompt translation for 16 products.
    expect(plan.estimatedCostUsd).toBeGreaterThan(4.9);
    expect(plan.estimatedCostUsd).toBeLessThan(5.3);
  });

  it("costs nothing at all for an empty plan", () => {
    const plan = planBatch([]);
    expect(plan.estimatedCostUsd).toBe(0);
    expect(plan.totalImagesToReview).toBe(0);
  });
});

describe("buildRecap", () => {
  it("reports every count a person needs before committing", () => {
    const parsed = realRows();
    const text = buildRecap(planBatch(parsed.rows), parsed.warnings, "catalog.csv");
    expect(text).toContain("catalog.csv");
    expect(text).toContain("40");
    expect(text).toContain("16");
    expect(text).toContain("24");
    expect(text).toContain("72");
  });

  it("shows the bill before it is incurred", () => {
    const parsed = realRows();
    const text = buildRecap(planBatch(parsed.rows), parsed.warnings, "catalog.csv");
    expect(text).toMatch(/\$5\.\d\d/);
  });

  it("says plainly that nothing has been spent yet", () => {
    const parsed = realRows();
    const text = buildRecap(planBatch(parsed.rows), parsed.warnings, "catalog.csv");
    expect(text.toLowerCase()).toContain("nothing has been generated");
  });

  it("surfaces content warnings without implying failure", () => {
    const text = buildRecap(
      planBatch(realRows().rows),
      ["Row 7: HG-099 has no Photo link — skipped."],
      "drop.csv",
    );
    expect(text).toContain("HG-099");
  });

  it("omits the warnings section when there is nothing to warn about", () => {
    const text = buildRecap(planBatch(realRows().rows), [], "clean.csv");
    expect(text.toLowerCase()).not.toContain("worth a look");
  });

  it("calls out that blank shot ideas become the original photo", () => {
    // A person reading "24 without" needs to know that is not 24 dropped rows.
    const parsed = realRows();
    const text = buildRecap(planBatch(parsed.rows), parsed.warnings, "catalog.csv");
    expect(text.toLowerCase()).toContain("original photo");
  });
});
