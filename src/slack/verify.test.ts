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
  it("posts all five probes", async () => {
    const { report } = await run();
    expect(report.posted).toHaveLength(5);
    expect(report.failures).toHaveLength(0);
  });

  it("mentions the approver in the mute probe", async () => {
    const { slack } = await run();
    expect(slack.posts.some((p) => p.text.includes("<@U_ELLIE>"))).toBe(true);
  });

  it("uploads probe 4's images without sharing them to a channel", async () => {
    // An image block referencing a file needs it hosted, not posted —
    // otherwise the probe would post the very messages it is supposed to be
    // testing an alternative to. Two images each for 4a and 4b.
    const { slack } = await run();
    const privateUploads = slack.uploads.filter((u) => u.channel === undefined);
    expect(privateUploads).toHaveLength(4);
  });

  it("tries each reference form in its own message", async () => {
    // The first version put both forms in one message. One block was
    // malformed, Slack rejected the whole message with invalid_blocks, and
    // the form that would have worked never rendered — so the probe answered
    // nothing. A probe that can fail as a unit is not a probe.
    const { slack } = await run();

    const byId = slack.posts.find((p) => p.text.startsWith("Probe 4a"));
    const byUrl = slack.posts.find((p) => p.text.startsWith("Probe 4b"));

    expect(JSON.stringify(byId!.blocks)).toContain('"slack_file":{"id":');
    expect(JSON.stringify(byId!.blocks)).not.toContain('"url"');
    expect(JSON.stringify(byUrl!.blocks)).toContain('"slack_file":{"url":');
  });

  it("never emits a slack_file reference with nothing in it", async () => {
    // This was the actual bug: files.completeUploadExternal returns only
    // {id, title}, so the url was undefined and serialised to an empty
    // object. Slack rejected the entire message.
    const { slack } = await run();
    for (const post of slack.posts) {
      expect(JSON.stringify(post.blocks ?? [])).not.toContain('"slack_file":{}');
    }
  });

  it("skips the url form rather than posting a broken block when no url comes back", async () => {
    const slack = createFakeSlack();
    slack.getFileUrl = async () => undefined;

    const report = await runVerificationProbes(slack, {
      channel: "C_REVIEW",
      approverUserId: "U_ELLIE",
      fetch: okFetch,
    });

    expect(report.failures.join(" ")).toContain("no url_private");
    // The id form is unaffected — that is the whole point of splitting them.
    expect(report.posted.join(" ")).toContain("by file id");
  });

  it("puts a button under each image rather than both at the end", async () => {
    const { slack } = await run();
    const probe4 = slack.posts.find((p) => p.text.startsWith("Probe 4a"));
    const types = (probe4!.blocks ?? []).map((b) => (b as { type: string }).type);
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
    expect(summary).toContain("Probes 4a and 4b");
    expect(summary.toLowerCase()).toContain("both");
  });
});
