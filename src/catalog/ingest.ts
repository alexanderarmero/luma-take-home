import type { SqlClient } from "../db/client.js";
import { addBatchRows, createBatch } from "../db/repository.js";
import type { Block, SlackClient } from "../slack/client.js";
import { parseCatalog } from "./parse.js";
import { buildRecap, planBatch } from "./recap.js";

export const UPLOAD_CALLBACK_ID = "catalog_upload";
export const UPLOAD_BLOCK_ID = "catalog_file";
export const UPLOAD_ACTION_ID = "catalog_file_input";
export const GENERATE_ACTION_ID = "generate_batch";

/**
 * The upload modal.
 *
 * Deliberately opened before any work: `trigger_id` expires about three
 * seconds after the slash command, so validation cannot happen first.
 */
export function buildUploadModal(): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: UPLOAD_CALLBACK_ID,
    title: { type: "plain_text", text: "Upload a catalog" },
    submit: { type: "plain_text", text: "Check it" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "Drop in a catalog export (CSV). I'll tell you what I'd make and " +
            "what it would cost *before* anything is generated.",
        },
      },
      {
        type: "input",
        block_id: UPLOAD_BLOCK_ID,
        label: { type: "plain_text", text: "Catalog CSV" },
        element: {
          type: "file_input",
          action_id: UPLOAD_ACTION_ID,
          filetypes: ["csv"],
          max_files: 1,
        },
      },
    ],
  };
}

function recapBlocks(text: string, batchId: number): Block[] {
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: GENERATE_ACTION_ID,
          text: { type: "plain_text", text: "Generate", emoji: true },
          style: "primary",
          value: String(batchId),
        },
      ],
    },
  ];
}

export interface IngestInput {
  slack: SlackClient;
  db: SqlClient;
  channel: string;
  fileUrl: string;
  filename: string;
}

export type IngestOutcome =
  | { ok: true; batchId: number; imagesToReview: number }
  | { ok: false; error: string };

/**
 * Downloads the uploaded catalog, validates it, records the batch, and posts
 * the recap.
 *
 * Nothing is generated and nothing is spent. This is the answer to "don't burn
 * our budget on stuff she'll reject" — not a smaller bill, but seeing the bill
 * first, which costs nothing because the validation has to happen anyway.
 */
export async function ingestCatalog(input: IngestInput): Promise<IngestOutcome> {
  const { slack, db, channel, fileUrl, filename } = input;

  let csv: string;
  try {
    csv = await slack.downloadFile(fileUrl);
  } catch (error) {
    const message = `I couldn't read *${filename}*: ${(error as Error).message}`;
    await slack.postMessage({ channel, text: message });
    return { ok: false, error: message };
  }

  const parsed = parseCatalog(csv);

  if (!parsed.ok) {
    const lines = [`*${filename}* — I can't use this file.`, "", parsed.error];
    for (const warning of parsed.warnings) lines.push(`• ${warning}`);
    const message = lines.join("\n");
    await slack.postMessage({ channel, text: message });
    return { ok: false, error: parsed.error };
  }

  // The batch is created only once the file is known to be usable, so a
  // rejected upload leaves no empty batch behind to confuse "latest".
  const batch = await createBatch(db, { sourceFilename: filename });
  await addBatchRows(db, batch.id, parsed.rows);

  const plan = planBatch(parsed.rows);
  const text = buildRecap(plan, parsed.warnings, filename);

  await slack.postMessage({
    channel,
    text,
    blocks: recapBlocks(text, batch.id),
  });

  return { ok: true, batchId: batch.id, imagesToReview: plan.totalImagesToReview };
}
