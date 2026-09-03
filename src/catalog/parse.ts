import { parse } from "csv-parse/sync";

/**
 * A product row, reduced to the fields the pipeline is allowed to use.
 *
 * `Notes` is deliberately absent. Measured against the real catalog, feeding
 * notes into prompts corrupts roughly twice as many rows as it improves — the
 * column mixes styling constraints, scheduling flags and multi-product
 * requests that a single-product generator cannot tell apart. The contract
 * with the team is: if it needs to be in the shot, it goes in Shot Idea.
 */
export interface CatalogRow {
  sku: string;
  productName: string;
  category: string;
  colour: string;
  material: string;
  price: string;
  photoUrl: string;
  /** null when the cell is blank — the row still runs, as a pass-through. */
  shotIdea: string | null;
}

export type ParseResult =
  | { ok: true; rows: CatalogRow[]; warnings: string[] }
  | { ok: false; error: string };

const REQUIRED_COLUMNS = [
  "SKU",
  "Product Name",
  "Category",
  "Color / Finish",
  "Material",
  "Price",
  "Photo",
  "Shot Idea",
] as const;

/**
 * Parses a catalog export.
 *
 * Structure is enforced: a missing column means the file cannot be used, and
 * the message says what was expected and what was found because the reader is
 * not an engineer. Content is tolerated: a blank shot idea, an odd price, a
 * note nobody can parse are all normal in a real spreadsheet export. A row
 * that cannot be generated at all is warned about and skipped rather than
 * failing the whole file.
 */
export function parseCatalog(csv: string): ParseResult {
  const text = csv.replace(/^﻿/, "").trim();
  if (text.length === 0) return { ok: false, error: "The file is empty." };

  let records: Record<string, string>[];
  // Captured from the header callback so the column check still works on a
  // file that has a header and no rows under it.
  let found: string[] = [];
  try {
    records = parse(text, {
      columns: (header: string[]) => {
        found = header.map((h) => h.trim());
        return found;
      },
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (error) {
    return {
      ok: false,
      error: `Could not read the file as CSV: ${(error as Error).message}`,
    };
  }

  const missing = REQUIRED_COLUMNS.filter((c) => !found.includes(c));

  if (missing.length > 0) {
    return {
      ok: false,
      error:
        `This file is missing ${missing.length === 1 ? "a required column" : "required columns"}: ` +
        `${missing.join(", ")}.\n` +
        `Columns found: ${found.join(", ")}.\n` +
        `Expected: ${REQUIRED_COLUMNS.join(", ")}.`,
    };
  }

  const rows: CatalogRow[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  records.forEach((record, index) => {
    // Spreadsheet row number as a person would count it: header is row 1.
    const line = index + 2;
    const sku = (record.SKU ?? "").trim();
    const photoUrl = (record.Photo ?? "").trim();

    if (!sku) {
      warnings.push(`Row ${line}: no SKU — skipped.`);
      return;
    }
    if (seen.has(sku)) {
      warnings.push(`Row ${line}: ${sku} appears more than once — kept the first.`);
      return;
    }
    if (!photoUrl) {
      warnings.push(`Row ${line}: ${sku} has no Photo link — skipped.`);
      return;
    }

    seen.add(sku);
    const shotIdea = (record["Shot Idea"] ?? "").trim();

    rows.push({
      sku,
      productName: (record["Product Name"] ?? "").trim(),
      category: (record.Category ?? "").trim(),
      colour: (record["Color / Finish"] ?? "").trim(),
      material: (record.Material ?? "").trim(),
      price: (record.Price ?? "").trim(),
      photoUrl,
      shotIdea: shotIdea === "" ? null : shotIdea,
    });
  });

  if (rows.length === 0) {
    return {
      ok: false,
      error:
        "No product rows found — the file has a header but nothing usable under it.",
    };
  }

  return { ok: true, rows, warnings };
}
