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
  // This is the shape the batched review needs.
  //
  // Deliberately two separate messages, one per reference form. The first
  // attempt combined them, one block was malformed, and Slack rejected the
  // whole message — so the form that would have worked never rendered and the
  // probe answered nothing. A probe that can fail as a unit is not a probe.
  const byId = await probeImagesInOneMessage(slack, doFetch, input.channel, "id");
  (byId.ok ? posted : failures).push(`4a · two images in one message, by file id${byId.detail}`);

  const byUrl = await probeImagesInOneMessage(slack, doFetch, input.channel, "url");
  (byUrl.ok ? posted : failures).push(`4b · two images in one message, by private url${byUrl.detail}`);

  return { posted, failures };
}

/**
 * Posts one message holding two images with a button under each, referencing
 * the files either by id or by private url.
 */
async function probeImagesInOneMessage(
  slack: SlackClient,
  doFetch: typeof fetch,
  channel: string,
  form: "id" | "url",
): Promise<{ ok: boolean; detail: string }> {
  try {
    const uploads = await Promise.all([
      uploadPrivately(slack, doFetch, SAMPLE_PHOTO, `probe4${form}_a.jpg`),
      uploadPrivately(slack, doFetch, SAMPLE_PHOTO_2, `probe4${form}_b.jpg`),
    ]);

    const references: Array<Record<string, string>> = [];
    for (const upload of uploads) {
      if (form === "id") {
        references.push({ id: upload.fileId });
        continue;
      }
      const url = await slack.getFileUrl(upload.fileId);
      // Never emit a half-built block: Slack rejects the entire message, and
      // the failure names the message rather than the field.
      if (!url) throw new Error("files.info returned no url_private");
      references.push({ url });
    }

    const blocks: Block[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `*Probe 4${form === "id" ? "a" : "b"} · two images in one message ` +
            `(by file ${form})*\nBoth images should appear, each with its own ` +
            `button directly underneath.`,
        },
      },
    ];

    references.forEach((reference, index) => {
      blocks.push({
        type: "image",
        alt_text: `Probe image ${index + 1}`,
        title: { type: "plain_text", text: `Image ${index + 1}` },
        slack_file: reference,
      });
      blocks.push(...probeButtons(`probe-4${form}-${index + 1}`));
    });

    await slack.postMessage({
      channel,
      text: `Probe 4${form === "id" ? "a" : "b"} — two images in one message.`,
      blocks,
    });

    return { ok: true, detail: "" };
  } catch (error) {
    return { ok: false, detail: ` — ${(error as Error).message}` };
  }
}

/** Uploads to Slack without sharing it anywhere. */
async function uploadPrivately(
  slack: SlackClient,
  doFetch: typeof fetch,
  photoUrl: string,
  filename: string,
): Promise<{ fileId: string }> {
  const response = await doFetch(photoUrl);
  if (!response.ok) {
    throw new Error(`could not fetch ${filename}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const { fileId } = await slack.uploadImage({
    filename,
    title: filename,
    bytes,
  });
  return { fileId };
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
    "• Probes 4a and 4b: each is a separate message trying a different way of " +
      "referencing the files. Whichever one renders both images, with a button " +
      "under each, is the form the batched review will use. Either working is " +
      "enough.",
  );
  return lines.join("\n");
}
