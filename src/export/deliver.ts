import type { SqlClient } from "../db/client.js";
import type { SlackClient } from "../slack/client.js";
import type { ObjectStore } from "../storage/store.js";
import { buildLatestExport } from "./zip.js";

export interface DeliverInput {
  db: SqlClient;
  slack: SlackClient;
  store: ObjectStore;
  channel: string;
  /** Attaches the zip to the message it belongs to, rather than beside it. */
  threadTs?: string | undefined;
  log?: (message: string) => void;
}

/**
 * Puts the approved photos of the confirmed batch into Slack, as a zip.
 *
 * Posted rather than fetched on request. The handoff is the moment the web
 * person needs the files, and a command they have to know about and remember
 * to run is a step at exactly the point where the old process lost things.
 */
export async function postExport(input: DeliverInput): Promise<boolean> {
  const { db, slack, store, channel, threadTs } = input;
  const log = input.log ?? (() => {});

  try {
    const result = await buildLatestExport(db, store);
    if (!result.ok) {
      await slack.postMessage({
        channel,
        ...(threadTs ? { threadTs } : {}),
        text: result.reason,
      });
      return false;
    }

    await slack.uploadFile({
      channel,
      ...(threadTs ? { threadTs } : {}),
      filename: result.filename,
      title: result.filename,
      bytes: result.bytes,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `*Batch #${result.batchId} — ${result.count} approved ` +
              `${result.count === 1 ? "photo" : "photos"}.*\nEvery file is named ` +
              "for its product and shot idea. MANIFEST.txt lists them with " +
              "their checksums.",
          },
        },
      ],
    });
    return true;
  } catch (error) {
    // Silence here leaves the web person waiting for a zip that is never
    // coming, at the one moment the whole process is about handing files over.
    log(`[export] failed: ${(error as Error).message}`);
    await slack
      .postMessage({
        channel,
        ...(threadTs ? { threadTs } : {}),
        text:
          "*I couldn't build the zip.* The batch is confirmed and every " +
          "approved photo is still stored — this is a packaging problem, not " +
          "a lost one. The overview page still has them all.",
      })
      .catch(() => {});
    return false;
  }
}
