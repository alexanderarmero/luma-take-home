import JSZip from "jszip";
import type { SqlClient } from "../db/client.js";
import { getApprovedImages, getDeliveredBatchId } from "../db/repository.js";
import type { ObjectStore } from "../storage/store.js";

export type ExportResult =
  | { ok: true; batchId: number; filename: string; bytes: Buffer; count: number }
  | { ok: false; reason: string };

/**
 * The approved images of the latest delivered batch, as a zip.
 *
 * Read through the delivered pointer rather than the highest batch id, so a
 * batch that was uploaded, generated or even fully reviewed but never
 * confirmed cannot be pulled. The web person structurally cannot receive an
 * unfinished set.
 */
export async function buildLatestExport(
  db: SqlClient,
  store: ObjectStore,
): Promise<ExportResult> {
  const batchId = await getDeliveredBatchId(db);
  if (batchId === null) {
    return {
      ok: false,
      reason:
        "Nothing has been confirmed yet, so there's nothing to hand over. " +
        "A batch becomes available once every photo has been decided and " +
        "confirmed.",
    };
  }

  const approved = await getApprovedImages(db, batchId);
  if (approved.length === 0) {
    return {
      ok: false,
      reason: `Batch #${batchId} was confirmed with no approved photos in it.`,
    };
  }

  const zip = new JSZip();
  const manifest: string[] = [
    `Batch ${batchId}`,
    `${approved.length} approved photos`,
    "",
    "filename,sku,sha256",
  ];

  for (const image of approved) {
    const object = await store.get(image.objectKey);
    // Stored bytes, unchanged. The file that ships is the file that was
    // approved, and the checksum recorded at storage time says so.
    zip.file(image.filename, object.bytes);
    manifest.push(`${image.filename},${image.sku},${image.checksum ?? ""}`);
  }

  zip.file("MANIFEST.txt", manifest.join("\n"));

  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    // Photographs do not compress; storing them keeps the export fast and the
    // bytes byte-identical to what is in the store.
    compression: "STORE",
  });

  return {
    ok: true,
    batchId,
    filename: `batch-${batchId}-approved.zip`,
    bytes,
    count: approved.length,
  };
}
