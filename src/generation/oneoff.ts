import type { ImageModel } from "../pricing.js";
import type { SlackClient } from "../slack/client.js";
import type { ObjectStore } from "../storage/store.js";
import { GenerationError, type ImageGenerator } from "./generator.js";
import { explainFailure } from "./message.js";

/** Long enough to describe a scene, short enough not to be a system prompt. */
export const MAX_PROMPT_LENGTH = 1000;

/** Give up rather than poll forever; a stuck generation must still answer. */
const MAX_POLLS = 60;
const POLL_INTERVAL_MS = 5_000;

export interface OneOffInput {
  slack: SlackClient;
  store: ObjectStore;
  generator: ImageGenerator;
  userId: string;
  fileUrl: string;
  filename: string;
  prompt: string;
  model: ImageModel;
  aspectRatio: string;
  publicBaseUrl: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

export type OneOffOutcome = { ok: true } | { ok: false; reason: string };

/**
 * One photograph, for one person, from their own image and their own words.
 *
 * Nothing here touches a batch. It has no review, no approval and no delivery
 * pointer, because it is not part of what gets published — it is the thing you
 * do when you want to see whether an idea is worth putting in the catalog at
 * all. Keeping it out of `images` is what stops a try-out from ever reaching a
 * handoff.
 *
 * The answer goes to the asker's own conversation with the bot. A channel is
 * for work the team reviews; this is not that.
 */
export async function runOneOff(input: OneOffInput): Promise<OneOffOutcome> {
  const doFetch = input.fetch ?? fetch;
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = input.log ?? (() => {});

  const channel = await input.slack.openDirectMessage(input.userId);

  const fail = async (reason: string): Promise<OneOffOutcome> => {
    await input.slack
      .postMessage({ channel, text: reason })
      .catch(() => {});
    return { ok: false, reason };
  };

  await input.slack.postMessage({
    channel,
    text:
      `*Working on it.* One photo from your image and "${input.prompt}". ` +
      "It usually takes under a minute; I'll post it here.",
  });

  try {
    // Luma fetches the source itself, so the bytes have to leave Slack — a
    // Slack file URL needs our bot token and Luma does not have it.
    const source = await input.slack.downloadFileBytes(input.fileUrl);
    const stored = await input.store.put({
      bytes: source.bytes,
      contentType: source.contentType,
      filename: input.filename,
      prefix: "scratch",
    });
    const sourceUrl = `${input.publicBaseUrl}/src/${stored.key.split("/")[1]}`;

    const { generationId } = await input.generator.submit({
      prompt: input.prompt,
      sourceUrl,
      model: input.model,
      aspectRatio: input.aspectRatio,
      userId: `oneoff-${input.userId}`,
    });

    for (let poll = 0; poll < MAX_POLLS; poll += 1) {
      const result = await input.generator.poll(generationId);

      if (result.state === "completed") {
        const response = await doFetch(result.outputUrl);
        if (!response.ok) {
          return fail(`I made it but couldn't download it: HTTP ${response.status}.`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());

        await input.slack.uploadFile({
          channel,
          filename: "shot.jpg",
          title: input.prompt.slice(0, 80),
          bytes,
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: `*${input.prompt}*` },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text:
                    "A one-off — it isn't part of any batch and won't be " +
                    "published. Use `/luma upload` when you want shots the " +
                    "team reviews.",
                },
              ],
            },
          ],
        });
        return { ok: true };
      }

      if (result.state === "failed") {
        // The same taxonomy the batch path uses, so "moderated" reads the
        // same here as it does in a product's thread.
        return fail(`That didn't work — ${explainFailure(result.failureCode)}.`);
      }

      await sleep(POLL_INTERVAL_MS);
    }

    return fail(
      "It's taken longer than I'm willing to wait. It may still arrive at " +
        "Luma's end, but I've stopped watching.",
    );
  } catch (error) {
    const message =
      error instanceof GenerationError
        ? error.message
        : (error as Error).message;
    log(`[oneoff] ${message}`);
    return fail(`That didn't work: ${message}`);
  }
}
