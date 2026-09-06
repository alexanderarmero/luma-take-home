import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { grantWriteAccess } from "../access/store.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createApp } from "../slack/app.js";
import { createFakeSlack, type FakeSlack } from "../slack/testing.js";
import { createMemoryStore, type MemoryStore } from "../storage/memory.js";
import type { ImageGenerator } from "./generator.js";
import { runOneOff } from "./oneoff.js";
import {
  ONEOFF_CALLBACK_ID,
  ONEOFF_FILE_ACTION,
  ONEOFF_FILE_BLOCK,
  ONEOFF_PROMPT_ACTION,
  ONEOFF_PROMPT_BLOCK,
} from "./oneoff-modal.js";

const SECRET = "test-signing-secret";
const NOW = 1_700_000_000_000;
const ELLIE = "U_ELLIE";
const FILE_URL = "https://files.slack.com/files-pri/T1-F1/photo.jpg";

let db: TestDb;
let slack: FakeSlack;
let store: MemoryStore;
let deferred: Array<() => Promise<void>>;

beforeEach(async () => {
  db = await createTestDb();
  slack = createFakeSlack();
  store = createMemoryStore();
  deferred = [];
  slack.files.set(FILE_URL, "the-original-bytes");
});
afterEach(async () => {
  await db?.close();
});

const fetchOk = (async () =>
  new Response(Buffer.from("generated"), {
    status: 200,
    headers: { "content-type": "image/jpeg" },
  })) as unknown as typeof fetch;

const generator: ImageGenerator = {
  submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
  poll: async () => ({ state: "completed", outputUrl: "https://luma/out.jpg" }),
};

function run(overrides: Partial<Parameters<typeof runOneOff>[0]> = {}) {
  return runOneOff({
    slack,
    store,
    generator,
    userId: ELLIE,
    fileUrl: FILE_URL,
    filename: "photo.jpg",
    prompt: "On a sunlit windowsill.",
    model: "uni-1-max",
    aspectRatio: "1:1",
    publicBaseUrl: "https://shots.test",
    fetch: fetchOk,
    sleep: async () => {},
    ...overrides,
  });
}

function app() {
  return createApp({
    signingSecret: SECRET,
    now: () => NOW,
    defer: (task) => {
      deferred.push(task);
    },
    db,
    slack,
    store,
    generator,
    reviewChannelId: "C_REVIEW",
    approverUserId: ELLIE,
    publicBaseUrl: "https://shots.test",
    model: "uni-1-max",
    aspectRatio: "1:1",
    fetch: fetchOk,
  });
}

async function flush() {
  for (const task of deferred.splice(0)) await task();
}

function sign(body: string) {
  const ts = Math.floor(NOW / 1000);
  const digest = createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex");
  return {
    "content-type": "application/x-www-form-urlencoded",
    "x-slack-request-timestamp": String(ts),
    "x-slack-signature": `v0=${digest}`,
  };
}

function command(text: string, userId = ELLIE) {
  const body = new URLSearchParams({
    command: "/luma",
    text,
    user_id: userId,
    channel_id: "C_REVIEW",
    trigger_id: "trigger-123",
  }).toString();
  return new Request("http://localhost/slack/commands", {
    method: "POST",
    headers: sign(body),
    body,
  });
}

function submission(prompt = "On a windowsill.", userId = ELLIE, withFile = true) {
  const payload = {
    type: "view_submission",
    user: { id: userId },
    view: {
      callback_id: ONEOFF_CALLBACK_ID,
      state: {
        values: {
          [ONEOFF_FILE_BLOCK]: {
            [ONEOFF_FILE_ACTION]: {
              files: withFile ? [{ id: "F1", name: "photo.jpg", url_private: FILE_URL }] : [],
            },
          },
          [ONEOFF_PROMPT_BLOCK]: { [ONEOFF_PROMPT_ACTION]: { value: prompt } },
        },
      },
    },
  };
  const body = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  return new Request("http://localhost/slack/interactions", {
    method: "POST",
    headers: sign(body),
    body,
  });
}

describe("a one-off shot", () => {
  it("answers in the asker's own conversation, never the channel", async () => {
    await run();

    expect(slack.dms).toEqual([`D_${ELLIE}`]);
    expect(slack.posts.every((p) => p.channel === `D_${ELLIE}`)).toBe(true);
    expect(slack.uploads.every((u) => u.channel === `D_${ELLIE}`)).toBe(true);
  });

  it("says it has started before it waits", async () => {
    // Generation outlasts any acknowledgement window, and silence looks
    // exactly like a broken command.
    await run();
    expect(slack.posts[0]!.text).toContain("Working on it");
  });

  it("hands Luma a URL it can actually fetch", async () => {
    // A Slack file URL needs our bot token, which Luma does not have — so the
    // bytes have to leave Slack and be served from somewhere public.
    let sourceUrl = "";
    await run({
      generator: {
        submit: async (input) => {
          sourceUrl = input.sourceUrl;
          return { generationId: "gen-1", rateLimit: {} };
        },
        poll: async () => ({ state: "completed", outputUrl: "https://luma/out.jpg" }),
      },
    });

    // Extension kept: Luma is fetching this as an image, not as an opaque blob.
    expect(sourceUrl).toMatch(/^https:\/\/shots\.test\/src\/[0-9a-f-]{36}\.jpg$/);
  });

  it("keeps its source out of the batch image namespace", async () => {
    // Two disjoint prefixes, so neither serving route can reach the other's
    // objects.
    await run();
    const keys = [...store.objects.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^scratch\//);
  });

  it("delivers the photo with the words it was made from", async () => {
    await run({ prompt: "Rain outside." });

    const upload = slack.uploads[0]!;
    expect(upload.bytes.toString()).toBe("generated");
    expect(JSON.stringify(upload.blocks)).toContain("Rain outside.");
  });

  it("labels it as disposable, because it looks like the real thing", async () => {
    await run();
    expect(JSON.stringify(slack.uploads[0]!.blocks)).toContain("isn't part of any batch");
  });

  it("explains a refusal in the same words the batch path uses", async () => {
    await run({
      generator: {
        submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
        poll: async () => ({
          state: "failed",
          failureCode: "moderated",
          failureReason: null,
          retryable: false,
        }),
      },
    });

    expect(slack.uploads).toHaveLength(0);
    expect(slack.posts.at(-1)!.text.toLowerCase()).toContain("didn't work");
  });

  it("stops waiting rather than polling forever", async () => {
    let polls = 0;
    const outcome = await run({
      generator: {
        submit: async () => ({ generationId: "gen-1", rateLimit: {} }),
        poll: async () => {
          polls += 1;
          return { state: "pending" };
        },
      },
    });

    expect(outcome).toMatchObject({ ok: false });
    expect(polls).toBeLessThanOrEqual(60);
    expect(slack.posts.at(-1)!.text).toContain("stopped watching");
  });

  it("says so in the DM when the download fails, rather than going quiet", async () => {
    slack.files.delete(FILE_URL);
    const outcome = await run();

    expect(outcome).toMatchObject({ ok: false });
    expect(slack.posts.at(-1)!.text).toContain("didn't work");
  });
});

describe("/luma generate", () => {
  it("opens the modal", async () => {
    await app().request(command("generate"));
    expect(slack.views[0]!.view.callback_id).toBe(ONEOFF_CALLBACK_ID);
  });

  it("says the result is private and unreviewed", async () => {
    await app().request(command("generate"));
    const view = JSON.stringify(slack.views[0]!.view);
    expect(view).toContain("conversation with me");
    expect(view).toContain("never published");
  });

  it("refuses someone who cannot approve photos, because it spends money", async () => {
    const res = await app().request(command("generate", "U_STRANGER"));
    expect(((await res.json()) as { text: string }).text).toContain("Only people who can");
    expect(slack.views).toHaveLength(0);
  });

  it("admits anyone on the access list", async () => {
    await grantWriteAccess(db, "U_MAYA", ELLIE);
    await app().request(command("generate", "U_MAYA"));
    expect(slack.views).toHaveLength(1);
  });

  it("is in the glossary", async () => {
    const res = await app().request(command("nonsense"));
    expect(((await res.json()) as { text: string }).text).toContain("/luma generate");
  });
});

describe("submitting one", () => {
  it("closes the modal and answers afterwards", async () => {
    const res = await app().request(submission());
    expect(res.status).toBe(200);
    expect(slack.posts).toHaveLength(0);

    await flush();
    expect(slack.uploads[0]!.channel).toBe(`D_${ELLIE}`);
  });

  it("re-checks access on submit, because the view outlives the permission", async () => {
    const res = await app().request(submission("x", "U_STRANGER"));
    const body = (await res.json()) as {
      response_action: string;
      errors: Record<string, string>;
    };

    expect(body.response_action).toBe("errors");
    expect(body.errors[ONEOFF_PROMPT_BLOCK]).toContain("no longer have access");
    expect(deferred).toHaveLength(0);
  });

  it("returns a missing file into its own field", async () => {
    const res = await app().request(submission("x", ELLIE, false));
    const body = (await res.json()) as { errors: Record<string, string> };
    expect(body.errors[ONEOFF_FILE_BLOCK]).toBeDefined();
    expect(deferred).toHaveLength(0);
  });
});

describe("serving a one-off source", () => {
  it("serves it back for Luma to fetch", async () => {
    const stored = await store.put({
      bytes: Buffer.from("bytes"),
      contentType: "image/jpeg",
      filename: "photo.jpg",
      prefix: "scratch",
    });
    const id = stored.key.split("/")[1]!.replace(".jpg", "");

    const res = await app().request(`/src/${id}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("bytes");
  });

  it("cannot be used to reach a batch's images", async () => {
    const batchImage = await store.put({
      bytes: Buffer.from("private"),
      contentType: "image/jpeg",
      filename: "HG-002.jpg",
    });
    const id = batchImage.key.split("/")[1]!.replace(".jpg", "");

    expect((await app().request(`/src/${id}`)).status).toBe(404);
  });

  it("refuses anything that isn't a minted id", async () => {
    expect((await app().request("/src/..%2Fimages%2Fx")).status).toBe(404);
  });
});
