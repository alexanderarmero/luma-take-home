import type { SqlClient } from "../db/client.js";
import { getBatchProducts, type ProductView } from "../db/repository.js";

/** RFC 4180 quoting: only what needs it, and doubled quotes inside. */
function cell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function imageUrl(baseUrl: string, objectKey: string): string {
  const id = objectKey.replace(/^images\//, "").replace(/\.jpg$/, "");
  return `${baseUrl}/img/${id}`;
}

export interface CatalogCsv {
  filename: string;
  content: string;
}

type Mode = "generated" | "approved";

/**
 * The catalog with a column per shot.
 *
 * One column per candidate rather than several links crammed into one cell:
 * a spreadsheet is the whole point of the format, and a cell holding three
 * URLs is not something anyone can sort, filter or click.
 */
function build(
  products: Awaited<ReturnType<typeof getBatchProducts>>,
  batchId: number,
  baseUrl: string,
  mode: Mode,
): CatalogCsv {
  const keep = (image: ProductView["images"][number]) =>
    mode === "approved" ? image.decision === "approved" : image.jobState !== "failed";

  const widest = Math.max(
    1,
    ...products.map((p) => p.images.filter(keep).length),
  );

  const header = [
    "SKU",
    "Product Name",
    "Shot Idea",
    ...Array.from({ length: widest }, (_, i) => `Photo ${i + 1}`),
    mode === "approved" ? "Approved" : "Status",
  ];

  const rows = products.map((product) => {
    const images = product.images.filter(keep);
    const urls = Array.from({ length: widest }, (_, i) => {
      const image = images[i];
      return image?.objectKey ? imageUrl(baseUrl, image.objectKey) : "";
    });

    const status =
      mode === "approved"
        ? String(images.length)
        : images.length === 0
          ? "none generated"
          : `${images.length} generated`;

    return [
      product.sku,
      product.productName,
      product.shotIdea ?? "",
      ...urls,
      status,
    ].map(cell).join(",");
  });

  return {
    filename:
      mode === "approved"
        ? `batch-${batchId}-approved.csv`
        : `batch-${batchId}-generated.csv`,
    content: [header.map(cell).join(","), ...rows].join("\n"),
  };
}

/** What was made. Emitted once a batch is ready to review. */
export async function buildGeneratedCatalog(
  db: SqlClient,
  batchId: number,
  baseUrl: string,
): Promise<CatalogCsv> {
  return build(await getBatchProducts(db, batchId), batchId, baseUrl, "generated");
}

/**
 * What was chosen. Emitted on confirmation.
 *
 * This is the one artefact that writes back to the spreadsheet the team
 * actually lives in — the sheet has nowhere to record an outcome, which is the
 * mechanical reason nobody can say which requests are done.
 */
export async function buildApprovedCatalog(
  db: SqlClient,
  batchId: number,
  baseUrl: string,
): Promise<CatalogCsv> {
  return build(await getBatchProducts(db, batchId), batchId, baseUrl, "approved");
}
