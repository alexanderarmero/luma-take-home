import type { Block, SlackClient } from "./client.js";

/** One catalog photo, used as a realistic payload rather than a stub pixel. */
const SAMPLE_PHOTO =
  "https://take-home-service.lumalabs-ext.workers.dev/assets/fde/hg-002.jpg";

export const VERIFY_ACTION_ID = "verify_button";

/** A second catalog photo, so probe 4 can show two images in one message. */
const SAMPLE_PHOTO_2 =
  "https://take-home-service.lumalabs-ext.workers.dev/assets/fde/hg-005.jpg";

function probeButtons(label: string): Block[] {
  return [
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: VERIFY_ACTION_ID,
          text: { type: "plain_text", text: "Tap me", emoji: true },
          value: label,
          style: "primary",
        },
      ],
    },
  ];
}

export interface VerifyReport {
  posted: string[];
  failures: string[];
}

/**
 * Posts the three probes ticket 02 exists to settle. Each one can overturn a
 * decision the review surface is built on, and each is cheaper to test now
 * than to discover once the posting layer depends on it.
 */
export async function runVerificationProbes(
  slack: SlackClient,
  input: { channel: string; approverUserId: string; fetch?: typeof fetch },
): Promise<VerifyReport> {
  const doFetch = input.fetch ?? fetch;
  const posted: string[] = [];
  const failures: string[] = [];

  // F4.5 — can the app post at all in a channel with top-level posting
  // restricted, and do its buttons work there?
  try {
    await slack.postMessage({
      channel: input.channel,
      text: "Probe 1 of 3 — plain message with a button.",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "*Probe 1 · buttons in a restricted channel*\n" +
              "If you can see this, the app can post here. Tap the button: if it " +
              "turns into a confirmation, interactive components survive posting " +
              "restrictions.",
          },
        },
        ...probeButtons("probe-1-plain-message"),
      ],
    });
    posted.push("1 · plain message with a button");
  } catch (error) {
    failures.push(`1 · plain message — ${(error as Error).message}`);
  }

  // F4.12 — does a direct mention still reach someone who muted the channel?
  // This one is observed by a human; the probe only supplies the mention.
  try {
    await slack.postMessage({
      channel: input.channel,
      text: `Probe 2 of 3 — <@${input.approverUserId}> mention check.`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              `*Probe 2 · mention in a muted channel*\n<@${input.approverUserId}> — ` +
              "mute this channel first, then have someone re-run this probe. If " +
              "your sidebar badges anyway, one summary mention per batch is enough " +
              "and the image stream can post quietly.",
          },
        },
      ],
    });
    posted.push("2 · mention (mute the channel, then re-run)");
  } catch (error) {
    failures.push(`2 · mention — ${(error as Error).message}`);
  }

  // F8.2 — can interactive blocks ride on a file-share message? If not, image
  // bytes cannot live in Slack and stay one message per decision.
  try {
    const response = await doFetch(SAMPLE_PHOTO);
    if (!response.ok) {
      throw new Error(`could not fetch sample photo: HTTP ${response.status}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());

    await slack.uploadImage({
      channel: input.channel,
      filename: "HG-002_probe_01.jpg",
      title: "HG-002_probe_01.jpg",
      bytes,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              "*Probe 3 · buttons on an uploaded file*\n" +
              "If buttons appear under this image, image bytes can live in Slack " +
              "and still carry a decision. If they don't, images have to be " +
              "referenced from our storage instead.",
          },
        },
        ...probeButtons("probe-3-file-upload"),
      ],
    });
    posted.push("3 · file upload with buttons");
  } catch (error) {
    failures.push(`3 · file upload — ${(error as Error).message}`);
  }

  // F8.6 — can several images live in ONE message, each with its own buttons?
  // This is the shape the batched review needs: three candidates for a product
  // in a single post rather than three posts. It hinges on whether an image
  // block can reference a Slack-hosted file, and the docs do not say whether a
  // file that was never shared to a channel can be referenced by id.
  //
  // Both documented forms are tried in the same message, so one look tells us
  // which works: the first image by `id`, the second by `url`.
  try {
    const [first, second] = await Promise.all([
      uploadPrivately(slack, doFetch, SAMPLE_PHOTO, "HG-002_probe_a.jpg"),
      uploadPrivately(slack, doFetch, SAMPLE_PHOTO_2, "HG-005_probe_b.jpg"),
    ]);

    const blocks: Block[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*Probe 4 · several images in one message*\n" +
            "This is the shape a batched review would take. Two things to look " +
            "for: do *both* images appear, and does each button sit under its " +
            "own image?",
        },
      },
      {
        type: "image",
        alt_text: "First probe image, referenced by file id",
        title: { type: "plain_text", text: "By file id" },
        slack_file: { id: first.fileId },
      },
      ...probeButtons("probe-4-by-id"),
      {
        type: "image",
        alt_text: "Second probe image, referenced by private url",
        title: { type: "plain_text", text: "By private url" },
        slack_file: { url: second.urlPrivate },
      },
      ...probeButtons("probe-4-by-url"),
    ];

    await slack.postMessage({
      channel: input.channel,
      text: "Probe 4 of 4 — several images in one message.",
      blocks,
    });
    posted.push("4 · two images in one message (one by id, one by url)");
  } catch (error) {
    failures.push(`4 · images in one message — ${(error as Error).message}`);
  }

  return { posted, failures };
}

/** Uploads to Slack without sharing it anywhere, returning both references. */
async function uploadPrivately(
  slack: SlackClient,
  doFetch: typeof fetch,
  photoUrl: string,
  filename: string,
): Promise<{ fileId: string; urlPrivate?: string }> {
  const response = await doFetch(photoUrl);
  if (!response.ok) {
    throw new Error(`could not fetch ${filename}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());

  const { fileId, urlPrivate } = await slack.uploadImage({
    filename,
    title: filename,
    bytes,
  });
  return { fileId, ...(urlPrivate === undefined ? {} : { urlPrivate }) };
}

export function summariseReport(report: VerifyReport): string {
  const lines = ["*Verification probes*", ""];
  for (const item of report.posted) lines.push(`✓ posted ${item}`);
  for (const item of report.failures) lines.push(`✗ failed ${item}`);
  lines.push(
    "",
    "Now go and look at the channel. What you're checking:",
    "• Probes 1 and 3: do the buttons appear, and does tapping one change the message?",
    "• Probe 2: mute the channel, re-run, and see whether the mention still badges.",
    "• Probe 4: do *both* images show, and is each button under its own image? " +
      "If only one image renders, note which — it decides how the batched " +
      "review references its files.",
  );
  return lines.join("\n");
}
