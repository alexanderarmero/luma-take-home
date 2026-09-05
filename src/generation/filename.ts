const MAX_SLUG_WORDS = 4;
const MAX_SLUG_LENGTH = 30;

/**
 * Dropped so the meaningful words survive the word cap. "on a set dinner
 * table, with food in it" would otherwise slug to "on-a-set-dinner", which
 * tells the web person nothing about the photo they are uploading.
 *
 * Kept deliberately small. "up" and "over" are not here: they carry meaning in
 * shot language ("close-up", "draped over"), and stripping them produced
 * "holiday-table-close".
 */
const STOPWORDS = new Set([
  "a", "an", "the", "on", "in", "of", "with", "at", "to", "and", "it", "its",
  "for", "from", "by", "into", "onto", "some", "that", "this",
]);

/**
 * Turns a human shot idea into the readable middle of a filename.
 *
 * Kept short and word-bounded: the name has to survive being read aloud in
 * Slack, pasted into a spreadsheet, and skimmed in a zip listing.
 */
export function slugifyShotIdea(shotIdea: string): string {
  const words = shotIdea
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // Only drop stopwords while enough meaning survives; a shot idea that is
  // mostly stopwords is better rendered whole than reduced to one word.
  const meaningful = words.filter((w) => !STOPWORDS.has(w));
  const chosen = meaningful.length >= 2 ? meaningful : words;

  const slug = chosen
    .slice(0, MAX_SLUG_WORDS)
    .join("-")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");

  return slug || "shot";
}

export interface FilenameInput {
  sku: string;
  slot: number;
  /** null for a pass-through: the product's own photo, unmodified. */
  shotIdea: string | null;
}

/**
 * The one identifier, end to end.
 *
 * This string is the label on the Slack message, the name in the export zip,
 * and what the web person uploads. Deriving it once and reusing it everywhere
 * removes the translation step where a wrong file could be substituted — which
 * is the mechanism behind the incident this product exists to prevent.
 */
export function buildFilename({ sku, slot, shotIdea }: FilenameInput): string {
  const safe = safeSku(sku);
  if (shotIdea === null) return `${safe}_original.jpg`;
  const slot2 = String(slot).padStart(2, "0");
  return `${safe}_${slugifyShotIdea(shotIdea)}_${slot2}.jpg`;
}

/**
 * The SKU is copied verbatim out of an uploaded spreadsheet, and this string
 * becomes a zip entry name. A SKU of `../../x` would otherwise produce an entry
 * that escapes the extraction directory on many extractors.
 */
function safeSku(sku: string): string {
  const cleaned = sku.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  return cleaned || "SKU";
}
