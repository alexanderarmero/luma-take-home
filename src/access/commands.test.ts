import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testing.js";
import { createApp } from "../slack/app.js";
import { createFakeSlack, type FakeSlack } from "../slack/testing.js";
import {
  ACCESS_ADD_ACTION,
  ACCESS_ADD_BLOCK,
  ACCESS_CALLBACK_ID,
  ACCESS_REVOKE_ACTION,
  applyAccessChanges,
  buildAccessModal,
  revokeIfPermitted,
} from "./commands.js";
import { buildHelp } from "./help.js";
import { canWrite, grantWriteAccess, listWriteAccess } from "./store.js";

const SECRET = "test-signing-secret";
const NOW = 1_700_000_000_000;
const ELLIE = "U_ELLIE";
const MAYA = "U_MAYA";

let db: TestDb;
let slack: FakeSlack;
let deferred: Array<() => Promise<void>>;

beforeEach(async () => {
  db = await createTestDb();
  slack = createFakeSlack();
  deferred = [];
});
afterEach(async () => {
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
    slack,
    reviewChannelId: "C_REVIEW",
    approverUserId: ELLIE,
    publicBaseUrl: "https://shots.test",
  });
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

async function command(text: string, user = ELLIE) {
  const body = new URLSearchParams({
    command: "/luma",
    text,
    user_id: user,
    channel_id: "C_REVIEW",
    trigger_id: "trigger-1",
  }).toString();
  const res = await app().request(
    new Request("http://localhost/slack/commands", {
      method: "POST",
      headers: sign(body),
      body,
    }),
  );
  for (const task of deferred) await task();
  deferred = [];
  return res;
}

async function interaction(payload: unknown, user = ELLIE) {
  const withUser = { ...(payload as Record<string, unknown>), user: { id: user } };
  const body = `payload=${encodeURIComponent(JSON.stringify(withUser))}`;
  const res = await app().request(
    new Request("http://localhost/slack/interactions", {
      method: "POST",
      headers: sign(body),
      body,
    }),
  );
  for (const task of deferred) await task();
  deferred = [];
  return res;
}

describe("/luma help", () => {
  it("lists the commands", async () => {
    const payload = (await (await command("help")).json()) as { text: string };
    expect(payload.text).toContain("/luma upload");
    expect(payload.text).toContain("/luma signin");
    // The zip arrives with the confirmation, so there is nothing to run for
    // it — and the glossary should not name a command that no longer exists.
    expect(payload.text).not.toContain("/luma export");
    expect(payload.text).toContain("arrive as a zip");
  });

  it("hides access management from everyone but the approver", () => {
    expect(buildHelp(false)).not.toContain("/luma access");
    expect(buildHelp(true)).toContain("/luma access");
  });
});

describe("/luma signin", () => {
  it("answers privately with a single-use link", async () => {
    const payload = (await (await command("signin", MAYA)).json()) as {
      response_type: string;
      text: string;
    };
    // Ephemeral: visible to whoever typed it, and nobody else. Slack already
    // knows who that is, which is why this needs no email provider.
    expect(payload.response_type).toBe("ephemeral");
    expect(payload.text).toMatch(/https:\/\/shots\.test\/auth\/[0-9a-f]{32}/);
  });

  it("issues a different link every time", async () => {
    const a = (await (await command("signin")).json()) as { text: string };
    const b = (await (await command("signin")).json()) as { text: string };
    expect(a.text).not.toBe(b.text);
  });
});

describe("/auth/:token", () => {
  async function tokenFor(user: string) {
    const payload = (await (await command("signin", user)).json()) as { text: string };
    return payload.text.match(/auth\/([0-9a-f]{32})/)![1]!;
  }

  it("sets a session cookie that a forwarded URL cannot carry", async () => {
    const res = await app().request(`/auth/${await tokenFor(ELLIE)}`);
    const cookie = res.headers.get("set-cookie") ?? "";

    expect(cookie).toContain("luma_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("refuses a link that has already been used", async () => {
    const token = await tokenFor(ELLIE);
    await app().request(`/auth/${token}`);

    const second = await app().request(`/auth/${token}`);
    expect(second.status).toBe(400);
    expect(await second.text()).toContain("expired or been used");
  });

  it("refuses a token nobody issued", async () => {
    const res = await app().request(`/auth/${"0".repeat(32)}`);
    expect(res.status).toBe(400);
  });
});

describe("/luma access", () => {
  it("opens the modal for the approver", async () => {
    await command("access", ELLIE);
    expect(slack.views).toHaveLength(1);
    expect(slack.views[0]!.view.callback_id).toBe(ACCESS_CALLBACK_ID);
  });

  it("refuses anyone else, and says why", async () => {
    const payload = (await (await command("access", MAYA)).json()) as { text: string };
    expect(payload.text).toContain("Only the configured approver");
    expect(slack.views).toHaveLength(0);
  });

  it("says the approver cannot be removed", async () => {
    const modal = await buildAccessModal(db, ELLIE);
    expect(JSON.stringify(modal)).toContain("can't be removed here");
  });

  it("picks people rather than accepting typed identifiers", async () => {
    // A mistyped Slack ID fails; a mistyped email would silently grant a
    // stranger the ability to approve.
    const modal = await buildAccessModal(db, ELLIE);
    expect(JSON.stringify(modal)).toContain("multi_users_select");
  });
});

describe("granting and revoking", () => {
  it("grants through the modal", async () => {
    await interaction({
      type: "view_submission",
      view: {
        callback_id: ACCESS_CALLBACK_ID,
        state: {
          values: { [ACCESS_ADD_BLOCK]: { [ACCESS_ADD_ACTION]: { selected_users: [MAYA] } } },
        },
      },
    });

    expect(await canWrite(db, MAYA, ELLIE)).toBe(true);
  });

  it("refuses a grant from anyone but the approver", async () => {
    const outcome = await applyAccessChanges(db, {
      actorUserId: MAYA,
      approverUserId: ELLIE,
      addUserIds: ["U_SOMEONE"],
    });
    expect(outcome.ok).toBe(false);
    expect(await listWriteAccess(db)).toHaveLength(0);
  });

  it("does not add the approver, who has access by configuration", async () => {
    await applyAccessChanges(db, {
      actorUserId: ELLIE,
      approverUserId: ELLIE,
      addUserIds: [ELLIE],
    });
    expect(await listWriteAccess(db)).toHaveLength(0);
  });

  it("revokes through the row button and redraws the list", async () => {
    await grantWriteAccess(db, MAYA, ELLIE);
    await interaction({
      type: "block_actions",
      view: { id: "V1", callback_id: ACCESS_CALLBACK_ID },
      actions: [{ action_id: `${ACCESS_REVOKE_ACTION}:${MAYA}`, value: MAYA }],
    });

    expect(await canWrite(db, MAYA, ELLIE)).toBe(false);
    expect(slack.viewUpdates).toHaveLength(1);
  });

  it("refuses to let the approver remove themselves", async () => {
    // One tap would otherwise lock the team out with no way back but a redeploy.
    const outcome = await revokeIfPermitted(db, {
      actorUserId: ELLIE,
      approverUserId: ELLIE,
      targetUserId: ELLIE,
    });
    expect(outcome.ok).toBe(false);
    expect(await canWrite(db, ELLIE, ELLIE)).toBe(true);
  });

  it("refuses a revoke from anyone but the approver", async () => {
    await grantWriteAccess(db, MAYA, ELLIE);
    const outcome = await revokeIfPermitted(db, {
      actorUserId: MAYA,
      approverUserId: ELLIE,
      targetUserId: MAYA,
    });
    expect(outcome.ok).toBe(false);
    expect(await canWrite(db, MAYA, ELLIE)).toBe(true);
  });
});
