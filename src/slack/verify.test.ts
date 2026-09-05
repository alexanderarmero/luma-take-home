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
  it("posts every probe when Slack accepts them", async () => {
    const { report } = await run();
    expect(report.failures).toHaveLength(0);
    expect(report.posted).toHaveLength(7); // 1, 2, 3, 4a, 4b, 4c, 4d
  });

  it("mentions the approver in the mute probe", async () => {
    const { slack } = await run();
    expect(slack.posts.some((p) => p.text.includes("<@U_ELLIE>"))).toBe(true);
  });

  it("bisects the image variants smallest first", async () => {
    // Two attempts already failed with a bare `invalid_blocks`. Isolating one
    // variable per message is what turns that into an answer.
    const { slack } = await run();
    const labels = slack.posts.map((p) => p.text);

    expect(labels.some((t) => t.includes("4a · one image, public URL"))).toBe(true);
    expect(labels.some((t) => t.includes("4b · one image, slack_file by id"))).toBe(true);
    expect(labels.some((t) => t.includes("4c · one image, slack_file by url"))).toBe(true);
    expect(labels.some((t) => t.includes("4d · two images"))).toBe(true);
  });

  it("keeps the simplest variant free of anything that could confound it", async () => {
    const { slack } = await run();
    const simplest = slack.posts.find((p) => p.text.includes("4a"));
    const blocks = simplest!.blocks as Array<Record<string, unknown>>;

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: "image" });
    // No title, no buttons, no section: one variable at a time.
    expect(blocks[0]).not.toHaveProperty("title");
  });

  it("builds 4d as the shape the batched review would actually take", async () => {
    const { slack } = await run();
    const target = slack.posts.find((p) => p.text.includes("4d"));
    const types = (target!.blocks ?? []).map((b) => (b as { type: string }).type);
    expect(types).toEqual(["section", "image", "actions", "image", "actions"]);
  });

  it("uploads for the slack_file probes without sharing them anywhere", async () => {
    // Probe 3 shares deliberately — that is what it tests. The probe-4
    // uploads must not, or referencing a file by id would be testing nothing.
    const { slack } = await run();
    const forProbe4 = slack.uploads.filter((u) => u.filename.startsWith("probe4"));
    expect(forProbe4.length).toBeGreaterThan(0);
    expect(forProbe4.every((u) => u.channel === undefined)).toBe(true);
  });

  it("never emits a slack_file reference with nothing in it", async () => {
    const { slack } = await run();
    for (const post of slack.posts) {
      expect(JSON.stringify(post.blocks ?? [])).not.toContain('"slack_file":{}');
    }
  });

  it("records Slack's own explanation when a variant is rejected", async () => {
    // A bare `invalid_blocks` is what made this take three attempts.
    const slack = createFakeSlack();
    slack.postMessage = async (input) => {
      if (input.text.includes("4b")) {
        throw new Error(
          "Slack chat.postMessage failed: invalid_blocks — [ERROR] unsupported field [json-pointer:/blocks/0/slack_file]",
        );
      }
      return { ts: "1.1" };
    };

    const report = await runVerificationProbes(slack, {
      channel: "C_REVIEW",
      approverUserId: "U_ELLIE",
      fetch: okFetch,
    });

    expect(report.failures.join(" ")).toContain("json-pointer");
    // One variant failing must not stop the others.
    expect(report.posted.join(" ")).toContain("4a");
    expect(report.posted.join(" ")).toContain("4d");
  });

  it("fails only its own variant when a url cannot be resolved", async () => {
    const slack = createFakeSlack();
    slack.getFileUrl = async () => undefined;

    const report = await runVerificationProbes(slack, {
      channel: "C_REVIEW",
      approverUserId: "U_ELLIE",
      fetch: okFetch,
    });

    expect(report.failures.join(" ")).toContain("no url_private");
    expect(report.posted.join(" ")).toContain("4b");
  });

  it("tells the reader how to read the result", async () => {
    const { report } = await run();
    const summary = summariseReport(report);
    expect(summary).toContain("Probes 4a to 4d");
    expect(summary.toLowerCase()).toContain("localises");
  });
});
