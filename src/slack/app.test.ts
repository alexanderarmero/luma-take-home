import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBatch } from "../db/repository.js";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createApp } from "./app.js";

const SECRET = "test-signing-secret";
const NOW = 1_700_000_000_000;

let deferred: Array<() => Promise<void>>;
let db: TestDb;

// One database for the whole suite: most cases here never touch it, and
// booting Postgres per test would dominate the run time.
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db?.close();
});

function app() {
  return createApp({
    signingSecret: SECRET,
    now: () => NOW,
    defer: (task) => {
      deferred.push(task);
    },
    db,
  });
}

/** Build a signed slash-command request the way Slack would send it. */
function slashCommand(
  fields: Record<string, string>,
  opts: { secret?: string; timestampSeconds?: number } = {},
) {
  const body = new URLSearchParams({
    token: "verification-token",
    team_id: "T123",
    channel_id: "C123",
    user_id: "U_ELLIE",
    command: "/luma",
    ...fields,
  }).toString();

  const ts = opts.timestampSeconds ?? Math.floor(NOW / 1000);
  const digest = createHmac("sha256", opts.secret ?? SECRET)
    .update(`v0:${ts}:${body}`)
    .digest("hex");

  return new Request("http://localhost/slack/commands", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": String(ts),
      "x-slack-signature": `v0=${digest}`,
    },
    body,
  });
}

beforeEach(() => {
  deferred = [];
});

describe("health", () => {
  it("reports ok so a platform health check can see the service is up", async () => {
    const res = await app().request("/healthz");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ok" });
  });
});

describe("POST /slack/commands", () => {
  it("answers a signed ping from the deployed service", async () => {
    const res = await app().request(slashCommand({ text: "ping" }));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { text: string };
    expect(payload.text).toContain("pong");
  });

  it("rejects a request carrying no Slack signature", async () => {
    const res = await app().request(
      new Request("http://localhost/slack/commands", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "command=%2Fluma&text=ping",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a request signed with the wrong secret", async () => {
    const res = await app().request(
      slashCommand({ text: "ping" }, { secret: "not-our-secret" }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a replayed request from outside the skew window", async () => {
    const res = await app().request(
      slashCommand(
        { text: "ping" },
        { timestampSeconds: Math.floor(NOW / 1000) - 10 * 60 },
      ),
    );
    expect(res.status).toBe(401);
  });

  it("does not run deferred work before responding", async () => {
    // A handler that defers work must still answer Slack immediately; the
    // three-second acknowledgement window is the whole reason `defer` exists.
    const res = await app().request(slashCommand({ text: "slow" }));
    expect(res.status).toBe(200);
    expect(deferred).toHaveLength(1);
  });

  it("answers an unrecognised subcommand with usage rather than an error", async () => {
    const res = await app().request(slashCommand({ text: "wat" }));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { text: string };
    expect(payload.text.toLowerCase()).toContain("ping");
  });

  it("treats a bare command with no text as usage", async () => {
    const res = await app().request(slashCommand({ text: "" }));
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { text: string };
    expect(payload.text.toLowerCase()).toContain("ping");
  });
});

describe("/luma status", () => {
  it("answers before anything has been uploaded", async () => {
    // Its own database: asserting on emptiness against the shared one would
    // pass only while this test happened to run before any that inserts.
    const fresh = await createTestDb();
    try {
      const res = await createApp({
        signingSecret: SECRET,
        now: () => NOW,
        defer: () => {},
        db: fresh,
      }).request(slashCommand({ text: "status" }));
      const payload = (await res.json()) as { text: string };
      expect(payload.text.toLowerCase()).toContain("no batches");
    } finally {
      await fresh.close();
    }
  });

  it("reports the latest batch once one exists", async () => {
    await createBatch(db, { sourceFilename: "catalog.csv" });
    const res = await app().request(slashCommand({ text: "status" }));
    const payload = (await res.json()) as { text: string };
    expect(payload.text).toContain("catalog.csv");
  });

  it("is listed in the usage text so it is discoverable", async () => {
    const res = await app().request(slashCommand({ text: "wat" }));
    const payload = (await res.json()) as { text: string };
    expect(payload.text).toContain("status");
  });

  it("says something a person can act on when the database is unreachable", async () => {
    const broken = {
      query: async () => {
        throw new Error("connection terminated unexpectedly");
      },
      exec: async () => {},
      transaction: async () => {
        throw new Error("connection terminated unexpectedly");
      },
    } as unknown as TestDb;

    const res = await createApp({
      signingSecret: SECRET,
      now: () => NOW,
      defer: () => {},
      db: broken,
    }).request(slashCommand({ text: "status" }));

    expect(res.status).toBe(200);
    const payload = (await res.json()) as { text: string };
    expect(payload.text).toMatch(/database/i);
    expect(payload.text).not.toContain("connection terminated");
  });
});
