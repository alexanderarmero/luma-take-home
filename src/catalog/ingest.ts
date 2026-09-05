import type { SqlClient } from "../db/client.js";
import { addBatchRows, createBatch } from "../db/repository.js";
import type { SlackClient } from "../slack/client.js";
import { parseCatalog } from "./parse.js";
import { buildRecap, planBatch } from "./recap.js";

export const UPLOAD_CALLBACK_ID = "catalog_upload";
export const UPLOAD_BLOCK_ID = "catalog_file";
export const UPLOAD_ACTION_ID = "catalog_file_input";
export const RECAP_CALLBACK_ID = "catalog_recap";

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

/**
 * The view pushed the instant the upload is submitted.
 *
 * Reading and parsing the file takes longer than the three seconds Slack
 * allows for a submission response, so the honest thing to show is that the
 * work has started. `external_id` is chosen here because a view pushed in a
 * submission response never tells us its id — this is how we find it again.
 */
export function buildCheckingModal(externalId: string): Record<string, unknown> {
  return {
    type: "modal",
    external_id: externalId,
    title: { type: "plain_text", text: "Reading your file" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            ":hourglass_flowing_sand: *Reading your catalog.*\n\nThis takes a " +
            "few seconds. Nothing has been generated and nothing has been " +
            "charged.",
        },
      },
    ],
  };
}

/**
 * The recap, as the second step of the upload rather than a channel message.
 *
 * Generating is the modal's own submit button, so the estimate and the
 * decision are the same view: you cannot press Generate without the bill in
 * front of you. The batch id rides in `private_metadata`, which is the only
 * state Slack carries between a view and its submission.
 */
export function buildRecapModal(
  externalId: string,
  text: string,
  batchId: number,
): Record<string, unknown> {
  return {
    type: "modal",
    external_id: externalId,
    callback_id: RECAP_CALLBACK_ID,
    private_metadata: String(batchId),
    title: { type: "plain_text", text: "Ready to generate" },
    submit: { type: "plain_text", text: "Generate" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  };
}

/** Same view, no submit button: there is nothing to press Generate on. */
export function buildIngestErrorModal(
  externalId: string,
  text: string,
): Record<string, unknown> {
  return {
    type: "modal",
    external_id: externalId,
    title: { type: "plain_text", text: "I can't use this file" },
    close: { type: "plain_text", text: "Close" },
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }],
  };
}

export interface IngestInput {
  slack: SlackClient;
  db: SqlClient;
  /** The open modal to draw the outcome into. */
  externalId: string;
  fileUrl: string;
  filename: string;
}

export type IngestOutcome =
  | { ok: true; batchId: number; imagesToReview: number }
  | { ok: false; error: string };

/**
 * Downloads the uploaded catalog, validates it, records the batch, and draws
 * the recap into the modal the uploader still has open.
 *
 * Nothing is generated and nothing is spent. This is the answer to "don't burn
 * our budget on stuff she'll reject" — not a smaller bill, but seeing the bill
 * first, which costs nothing because the validation has to happen anyway.
 *
 * It stays in the modal because a rejected file is the uploader's problem to
 * fix, not news for the channel. The channel hears about a batch when one
 * actually starts.
 */
export async function ingestCatalog(input: IngestInput): Promise<IngestOutcome> {
  const { slack, db, externalId, fileUrl, filename } = input;

  const fail = async (message: string) => {
    await slack.updateView({
      externalId,
      view: buildIngestErrorModal(externalId, message),
    });
  };

  let csv: string;
  try {
    csv = await slack.downloadFile(fileUrl);
  } catch (error) {
    const message = `I couldn't read *${filename}*: ${(error as Error).message}`;
    await fail(message);
    return { ok: false, error: message };
  }

  const parsed = parseCatalog(csv);

  if (!parsed.ok) {
    const lines = [`*${filename}* — I can't use this file.`, "", parsed.error];
    for (const warning of parsed.warnings) lines.push(`• ${warning}`);
    await fail(lines.join("\n"));
    return { ok: false, error: parsed.error };
  }

  // The batch is created only once the file is known to be usable, so a
  // rejected upload leaves no empty batch behind to confuse "latest".
  const batch = await createBatch(db, { sourceFilename: filename });
  await addBatchRows(db, batch.id, parsed.rows);

  const plan = planBatch(parsed.rows);
  const text = buildRecap(plan, parsed.warnings, filename);

  await slack.updateView({
    externalId,
    view: buildRecapModal(externalId, text, batch.id),
  });

  return { ok: true, batchId: batch.id, imagesToReview: plan.totalImagesToReview };
}
