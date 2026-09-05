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

  // F8.6 — can several images share ONE message, each with its own buttons?
  //
  // Two attempts at this already failed with a bare `invalid_blocks`, so this
  // version bisects instead of guessing: four variants, smallest first, each
  // in its own message. Whichever is the first to fail localises the problem
  // to one field.
  const photo = await fetchBytes(doFetch, SAMPLE_PHOTO, "probe4_a.jpg");
  const photo2 = await fetchBytes(doFetch, SAMPLE_PHOTO_2, "probe4_b.jpg");

  const upload = async (bytes: Buffer, filename: string) => {
    const { fileId } = await slack.uploadImage({ filename, title: filename, bytes });
    return fileId;
  };

  // 4a — the simplest possible image block, pointing at a public URL. If this
  // fails, image blocks are not the problem's cause and something more basic
  // is wrong.
  await attempt(slack, input.channel, posted, failures, "4a · one image, public URL", [
    {
      type: "image",
      image_url: SAMPLE_PHOTO,
      alt_text: "A product photo",
    },
  ]);

  // 4b — the same block, referencing a Slack-hosted file by id.
  try {
    const fileId = await upload(photo, "probe4b.jpg");
    await attempt(slack, input.channel, posted, failures, "4b · one image, slack_file by id", [
      { type: "image", slack_file: { id: fileId }, alt_text: "A product photo" },
    ]);
  } catch (error) {
    failures.push(`4b · one image, slack_file by id — ${(error as Error).message}`);
  }

  // 4c — the same block, referencing that file by its private url.
  try {
    const fileId = await upload(photo, "probe4c.jpg");
    const url = await slack.getFileUrl(fileId);
    if (!url) throw new Error("files.info returned no url_private");
    await attempt(slack, input.channel, posted, failures, "4c · one image, slack_file by url", [
      { type: "image", slack_file: { url }, alt_text: "A product photo" },
    ]);
  } catch (error) {
    failures.push(`4c · one image, slack_file by url — ${(error as Error).message}`);
  }

  // 4d — the actual target shape: two images in one message, a button under
  // each, using public URLs. Our own /img endpoint serves images publicly, so
  // this form is available to the real thing if the slack_file forms are not.
  void photo2;
  await attempt(
    slack,
    input.channel,
    posted,
    failures,
    "4d · two images with their own buttons, public URLs",
    [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Probe 4d · the shape a batched review would take*",
        },
      },
      { type: "image", image_url: SAMPLE_PHOTO, alt_text: "First candidate" },
      ...probeButtons("probe-4d-1"),
      { type: "image", image_url: SAMPLE_PHOTO_2, alt_text: "Second candidate" },
      ...probeButtons("probe-4d-2"),
    ],
  );

  return { posted, failures };
}

/** Posts one message and records which way it went, with Slack's own detail. */
async function attempt(
  slack: SlackClient,
  channel: string,
  posted: string[],
  failures: string[],
  label: string,
  blocks: Block[],
): Promise<void> {
  try {
    await slack.postMessage({ channel, text: `Probe ${label}`, blocks });
    posted.push(label);
  } catch (error) {
    failures.push(`${label} — ${(error as Error).message}`);
  }
}

async function fetchBytes(
  doFetch: typeof fetch,
  url: string,
  filename: string,
): Promise<Buffer> {
  const response = await doFetch(url);
  if (!response.ok) {
    throw new Error(`could not fetch ${filename}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
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
    "• Probes 4a to 4d: four ways of putting an image in a message, smallest " +
      "first. The first one that fails localises the problem. 4d is the shape " +
      "the batched review would actually take.",
  );
  return lines.join("\n");
}
