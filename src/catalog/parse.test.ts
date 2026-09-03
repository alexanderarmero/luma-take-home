import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCatalog } from "./parse.js";

/** The customer's actual handoff. Quirks included, deliberately. */
const REAL_CATALOG = readFileSync("data/catalog.csv", "utf8");

const HEADER =
  "SKU,Product Name,Category,Color / Finish,Material,Price,Photo,Shot Idea,Notes";

describe("parseCatalog — the real handoff", () => {
  it("accepts the catalog as delivered", () => {
    const result = parseCatalog(REAL_CATALOG);
    expect(result.ok).toBe(true);
  });

  it("finds every product row", () => {
    const result = parseCatalog(REAL_CATALOG);
    if (!result.ok) throw new Error("expected success");
    expect(result.rows).toHaveLength(40);
  });

  it("finds the sixteen rows carrying a shot idea", () => {
    const result = parseCatalog(REAL_CATALOG);
    if (!result.ok) throw new Error("expected success");
    const withIdea = result.rows.filter((r) => r.shotIdea !== null);
    expect(withIdea).toHaveLength(16);
  });

  it("keeps a shot idea containing commas intact", () => {
    const result = parseCatalog(REAL_CATALOG);
    if (!result.ok) throw new Error("expected success");
    const mug = result.rows.find((r) => r.sku === "HG-002");
    expect(mug?.shotIdea).toBe("morning kitchen counter, steam, warm light");
  });

  it("does not read the Notes column into anything the generator sees", () => {
    // Notes mix styling constraints, scheduling flags and multi-product
    // requests; passed raw they corrupt more prompts than they improve.
    const result = parseCatalog(REAL_CATALOG);
    if (!result.ok) throw new Error("expected success");
    const row = result.rows.find((r) => r.sku === "HG-011");
    expect(JSON.stringify(row)).not.toContain("shoot with the mugs");
  });
});

describe("parseCatalog — structure is enforced", () => {
  it("rejects a file missing a required column, naming what it expected", () => {
    const csv = "SKU,Product Name,Price\nHG-001,Vase,$48";
    const result = parseCatalog(csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("Photo");
    expect(result.error).toContain("Shot Idea");
    // The reader is not an engineer: say what was found, not just what broke.
    expect(result.error).toContain("SKU, Product Name, Price");
  });

  it("rejects an empty file", () => {
    const result = parseCatalog("");
    expect(result.ok).toBe(false);
  });

  it("rejects a header with no data rows", () => {
    const result = parseCatalog(HEADER);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.toLowerCase()).toContain("no product rows");
  });

  it("accepts columns in a different order", () => {
    const csv =
      "Notes,Shot Idea,Photo,Price,Material,Color / Finish,Category,Product Name,SKU\n" +
      ",cosy shelf,https://example.com/a.jpg,$10,Stoneware,Sage,Decor,Vase,HG-001";
    const result = parseCatalog(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.rows[0]?.sku).toBe("HG-001");
  });
});

describe("parseCatalog — content quirks are tolerated, not rejected", () => {
  it("accepts a row with a blank shot idea", () => {
    const csv = `${HEADER}\nHG-001,Vase,Ceramics,Sage,Stoneware,$48,https://example.com/a.jpg,,`;
    const result = parseCatalog(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.rows[0]?.shotIdea).toBeNull();
  });

  it("accepts an unusual price without complaint", () => {
    const csv = `${HEADER}\nHG-001,Vase,Ceramics,Sage,Stoneware,forty-eight quid,https://example.com/a.jpg,,`;
    const result = parseCatalog(csv);
    expect(result.ok).toBe(true);
  });

  it("warns about a row with no photo and leaves it out, rather than failing the file", () => {
    const csv =
      `${HEADER}\n` +
      `HG-001,Vase,Ceramics,Sage,Stoneware,$48,https://example.com/a.jpg,,\n` +
      `HG-002,Mug,Ceramics,Sage,Stoneware,$28,,,`;
    const result = parseCatalog(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.rows).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("HG-002");
  });

  it("warns about a duplicate SKU and keeps the first", () => {
    const csv =
      `${HEADER}\n` +
      `HG-001,Vase,Ceramics,Sage,Stoneware,$48,https://example.com/a.jpg,,\n` +
      `HG-001,Vase again,Ceramics,Sage,Stoneware,$48,https://example.com/b.jpg,,`;
    const result = parseCatalog(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.rows).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("HG-001");
  });

  it("ignores a trailing blank line", () => {
    const csv = `${HEADER}\nHG-001,Vase,Ceramics,Sage,Stoneware,$48,https://example.com/a.jpg,,\n\n`;
    const result = parseCatalog(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.rows).toHaveLength(1);
  });

  it("tolerates a UTF-8 byte order mark on the header", () => {
    // Spreadsheet exports frequently carry one; rejecting the file over an
    // invisible character would be the worst possible first impression.
    const csv = `﻿${HEADER}\nHG-001,Vase,Ceramics,Sage,Stoneware,$48,https://example.com/a.jpg,,`;
    const result = parseCatalog(csv);
    expect(result.ok).toBe(true);
  });
});

describe("parseCatalog — messages point at the right place", () => {
  it("reports the physical spreadsheet line, not the record index", () => {
    // A blank line shifts every record after it. Pointing someone at the wrong
    // row of their own sheet is worse than saying nothing.
    const csv =
      `${HEADER}\n` +
      `HG-001,Vase,Ceramics,Sage,Stoneware,$48,https://example.com/a.jpg,,\n` +
      `\n` +
      `HG-002,Mug,Ceramics,Sage,Stoneware,$28,,,`;
    const result = parseCatalog(csv);
    if (!result.ok) throw new Error("expected success");
    expect(result.warnings[0]).toContain("Row 4");
  });

  it("keeps line numbers honest across a quoted multi-line cell", () => {
    const csv =
      `${HEADER}\n` +
      `HG-001,Vase,Ceramics,Sage,Stoneware,$48,https://example.com/a.jpg,"warm light,\nsteam",\n` +
      `HG-002,Mug,Ceramics,Sage,Stoneware,$28,,,`;
    const result = parseCatalog(csv);
    if (!result.ok) throw new Error("expected success");
    expect(result.warnings[0]).toContain("Row 4");
  });

  it("explains why a file with no usable rows was rejected", () => {
    // The realistic case: a re-export where the Photo column came through
    // blank. "Nothing usable" alone does not tell the reader which column
    // to go and look at.
    const csv =
      `${HEADER}\n` +
      `HG-001,Vase,Ceramics,Sage,Stoneware,$48,,,\n` +
      `HG-002,Mug,Ceramics,Sage,Stoneware,$28,,,`;
    const result = parseCatalog(csv);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(" ")).toContain("Photo");
  });
});
