import type { BatchRow } from "../db/repository.js";

export interface BrandContext {
  palette: string[];
  materials: string[];
  categories: string[];
  /** Shot ideas the team has already written, used as tone calibration. */
  toneExamples: string[];
}

const MAX_TONE_EXAMPLES = 8;

/** Splits "Sage Cream" and "Ochre Clay Terracotta" into their colour words. */
function colourWords(value: string): string[] {
  return value
    .split(/[\s,/]+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2);
}

function mostCommon(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

/**
 * The brand's look, read out of its own catalog.
 *
 * The colour and material columns describe an identity nobody has to invent —
 * terracotta, sage, stoneware, linen. Feeding that back in is the difference
 * between shots that look like this brand and shots that look like stock.
 */
export function buildBrandContext(rows: BatchRow[]): BrandContext {
  return {
    palette: mostCommon(rows.flatMap((r) => colourWords(r.colour)), 12),
    materials: mostCommon(rows.map((r) => r.material).filter(Boolean), 8),
    categories: mostCommon(rows.map((r) => r.category).filter(Boolean), 8),
    // The team's own words, so the output reads like something they wrote.
    toneExamples: rows
      .map((r) => r.shotIdea)
      .filter((idea): idea is string => idea !== null)
      .slice(0, MAX_TONE_EXAMPLES),
  };
}

/**
 * The stable half of the request.
 *
 * Identical for every product in a batch, which is what makes it cacheable —
 * sixteen calls in quick succession over one unchanging prefix is exactly the
 * shape prompt caching is for.
 */
export function buildSystemPrompt(brand: BrandContext): string {
  const lines = [
    "You turn a home-goods brand's shorthand shot ideas into prompts for an " +
      "image model that edits an existing product photograph into a styled scene.",
    "",
    "THE BRAND, read from their own catalog:",
    `• Palette: ${brand.palette.join(", ")}`,
    `• Materials: ${brand.materials.join(", ")}`,
    `• Categories: ${brand.categories.join(", ")}`,
    "Muted, natural, handmade. Real rooms and daylight, not a studio sweep.",
  ];

  if (brand.toneExamples.length > 0) {
    lines.push(
      "",
      "HOW THIS TEAM WRITES SHOT IDEAS — match this register, not ad copy:",
      ...brand.toneExamples.map((example) => `• "${example}"`),
    );
  }

  lines.push(
    "",
    "YOUR JOB",
    "Given one shot idea and the product it belongs to, write prompts that are " +
      "genuinely different readings of that same idea — not rewordings of each " +
      "other. Vary framing, time of day, and how styled the scene is. Make at " +
      "least one noticeably restrained, because the most common rejection this " +
      "team gives is that a shot looks too staged.",
    "",
    "RULES",
    "• The product in the source photograph is the subject. Never change its " +
      "shape, colour, material or proportions, and never add a different product.",
    "• Describe the scene around it: surface, light, setting, a prop or two.",
    "• One or two sentences each. Concrete and visual. No brand names, no text " +
      "in the image, no people's faces.",
    "• Stay faithful to the shot idea. If it says morning, it is morning.",
  );

  return lines.join("\n");
}
