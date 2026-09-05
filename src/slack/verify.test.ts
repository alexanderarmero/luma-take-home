import { describe, expect, it } from "vitest";
import { createFakeSlack } from "./testing.js";
import { runVerificationProbes, summariseReport } from "./verify.js";

const photoBytes = Buffer.from("jpeg");
const okFetch = (async () =>
  new Response(photoBytes, {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  })) as unknown as typeof fetch;

async function run(fetchImpl: typeof fetch = okFetch) {
  const slack = createFakeSlack();
  const report = await runVerificationProbes(slack, {
    channel: "C_REVIEW",
    approverUserId: "U_ELLIE",
    fetch: fetchImpl,
  });
  return { slack, report };
}

describe("verification probes", () => {
  it("posts all four probes", async () => {
    const { report } = await run();
    expect(report.posted).toHaveLength(4);
    expect(report.failures).toHaveLength(0);
  });

  it("mentions the approver in the mute probe", async () => {
    const { slack } = await run();
    expect(slack.posts.some((p) => p.text.includes("<@U_ELLIE>"))).toBe(true);
  });

  it("uploads probe 4's images without sharing them to a channel", async () => {
    // An image block referencing a file by id needs the file hosted, not
    // posted — otherwise the probe would post the very messages it is
    // supposed to be testing an alternative to.
    const { slack } = await run();
    const privateUploads = slack.uploads.filter((u) => u.channel === undefined);
    expect(privateUploads).toHaveLength(2);
  });

  it("references one image by id and the other by url, in one message", async () => {
    // Both documented forms in a single message, so one look settles which
    // works rather than needing two runs.
    const { slack } = await run();
    const probe4 = slack.posts.find((p) => p.text.startsWith("Probe 4"));
    const blocks = JSON.stringify(probe4!.blocks);

    expect(blocks).toContain('"slack_file":{"id":');
    expect(blocks).toContain('"slack_file":{"url":');
  });

  it("puts a button under each image rather than both at the end", async () => {
    const { slack } = await run();
    const probe4 = slack.posts.find((p) => p.text.startsWith("Probe 4"));
    const types = (probe4!.blocks ?? []).map((b) => (b as { type: string }).type);
    // section, image, actions, image, actions
    expect(types).toEqual(["section", "image", "actions", "image", "actions"]);
  });

  it("reports a probe that fails without abandoning the others", async () => {
    const failingFetch = (async () =>
      new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const { report } = await run(failingFetch);

    // Probes 1 and 2 need no photo and still go out.
    expect(report.posted.length).toBeGreaterThanOrEqual(2);
    expect(report.failures.length).toBeGreaterThanOrEqual(1);
  });

  it("tells the reader what to look at", async () => {
    const { report } = await run();
    const summary = summariseReport(report);
    expect(summary).toContain("Probe 4");
    expect(summary.toLowerCase()).toContain("both");
  });
});
