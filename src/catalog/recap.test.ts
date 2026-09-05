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
  function recapForRealCatalog(warnings: string[] = []) {
    const parsed = realRows();
    return buildRecap(planBatch(parsed.rows), warnings, "catalog.csv");
  }

  it("reports every count a person needs before committing", () => {
    const text = recapForRealCatalog();
    expect(text).toContain("catalog.csv");
    expect(text).toContain("40 products");
    expect(text).toContain("16 have something written");
    expect(text).toContain("24 have that column blank");
    expect(text).toContain("72 images");
  });

  it("shows the bill before it is incurred", () => {
    expect(recapForRealCatalog()).toMatch(/\$5\.\d\d in total/);
  });

  it("says plainly that nothing has been spent yet", () => {
    expect(recapForRealCatalog().toLowerCase()).toContain(
      "nothing has been generated and nothing has been charged yet",
    );
  });

  it("uses no arrows or shorthand a reader has to interpret", () => {
    // The relationship between "16 rows" and "48 photos" has to be stated,
    // not implied by punctuation.
    const text = recapForRealCatalog();
    expect(text).not.toContain("→");
    expect(text).not.toContain("->");
  });

  it("spells out that a blank shot idea means the original photo, unchanged", () => {
    const text = recapForRealCatalog().toLowerCase();
    expect(text).toContain("would not invent anything");
    expect(text).toContain("existing white-background photo");
    expect(text).toContain("unchanged");
  });

  it("says outright that the unchanged photos are free, and why", () => {
    expect(recapForRealCatalog()).toContain(
      "they cost nothing because nothing is generated for them",
    );
  });

  it("names what the reviewer will actually be doing, and where", () => {
    const text = recapForRealCatalog();
    expect(text).toContain("overview page");
    expect(text).toContain("side by side");
  });

  it("surfaces skipped rows under a heading that says what happened to them", () => {
    const text = recapForRealCatalog([
      "Row 7: HG-099 has no Photo link — skipped.",
    ]);
    expect(text).toContain("Rows I could not use");
    expect(text).toContain("HG-099");
    expect(text).toContain("The rest of the file is unaffected");
  });

  it("omits the skipped-rows section when nothing was skipped", () => {
    expect(recapForRealCatalog()).not.toContain("Rows I could not use");
  });

  it("does not promise styled photos when no row has a shot idea", () => {
    // The likely shape of next month's drop: a fresh catalog with the Shot
    // Idea column still empty.
    const blanksOnly = realRows().rows.map((r) => ({ ...r, shotIdea: null }));
    const text = buildRecap(planBatch(blanksOnly), [], "drop.csv");
    expect(text).toContain("No product has a shot idea");
    expect(text).toContain("Nothing at all");
    expect(text).not.toMatch(/\$\d/);
  });

  it("reads correctly for a single product", () => {
    const one = realRows().rows.filter((r) => r.shotIdea !== null).slice(0, 1);
    const text = buildRecap(planBatch(one), [], "one.csv");
    expect(text).toContain("1 product.");
    expect(text).toContain("1 has something written");
    // Verbose copy makes clumsy agreement glaring, so it is worth asserting.
    expect(text).not.toContain("1 products");
    expect(text).not.toContain("1 have");
    expect(text).not.toContain("each of the 1");
  });

  it("reads correctly when a count is zero", () => {
    const withIdeas = realRows().rows.filter((r) => r.shotIdea !== null);
    const text = buildRecap(planBatch(withIdeas), [], "all-styled.csv");
    expect(text).toContain("0 have that column blank");
    expect(text).not.toContain("0 has");
  });
});
