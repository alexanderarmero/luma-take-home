import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../db/testing.js";
import {
  canAdminister,
  canWrite,
  createMagicLink,
  endSession,
  findSession,
  grantWriteAccess,
  listWriteAccess,
  redeemMagicLink,
  revokeWriteAccess,
} from "./store.js";

const ELLIE = "U_ELLIE";
const MAYA = "U_MAYA";
const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db?.close();
});

describe("who may act", () => {
  it("always lets the configured approver through, with no row", async () => {
    // Otherwise revoking the last granted user locks everyone out with no way
    // back but a redeploy.
    expect(await canWrite(db, ELLIE, ELLIE)).toBe(true);
    expect(await listWriteAccess(db)).toHaveLength(0);
  });

  it("refuses anyone who has not been granted access", async () => {
    expect(await canWrite(db, MAYA, ELLIE)).toBe(false);
  });

  it("lets a granted user through", async () => {
    await grantWriteAccess(db, MAYA, ELLIE);
    expect(await canWrite(db, MAYA, ELLIE)).toBe(true);
  });

  it("stops letting them through the moment access is revoked", async () => {
    await grantWriteAccess(db, MAYA, ELLIE);
    await revokeWriteAccess(db, MAYA);
    expect(await canWrite(db, MAYA, ELLIE)).toBe(false);
  });

  it("refuses an empty user id rather than treating it as a match", async () => {
    expect(await canWrite(db, "", "")).toBe(false);
  });

  it("records who granted access to whom", async () => {
    await grantWriteAccess(db, MAYA, ELLIE);
    const [entry] = await listWriteAccess(db);
    expect(entry).toMatchObject({ slackUserId: MAYA, grantedBy: ELLIE });
  });

  it("is idempotent, so granting twice is harmless", async () => {
    await grantWriteAccess(db, MAYA, ELLIE);
    await grantWriteAccess(db, MAYA, ELLIE);
    expect(await listWriteAccess(db)).toHaveLength(1);
  });
});

describe("who may administer the list", () => {
  it("is the configured approver alone", () => {
    expect(canAdminister(ELLIE, ELLIE)).toBe(true);
    expect(canAdminister(MAYA, ELLIE)).toBe(false);
  });

  it("is nobody when there is no configured approver", () => {
    // Fail closed: two missing values must not compare equal.
    expect(canAdminister("", "")).toBe(false);
  });
});

describe("magic links", () => {
  it("trades a link for a session", async () => {
    const token = await createMagicLink(db, ELLIE, NOW);
    const session = await redeemMagicLink(db, token, NOW);
    expect(session).toMatchObject({ slackUserId: ELLIE });
  });

  it("can only be redeemed once", async () => {
    const token = await createMagicLink(db, ELLIE, NOW);
    await redeemMagicLink(db, token, NOW);
    expect(await redeemMagicLink(db, token, NOW)).toBeNull();
  });

  it("expires quickly, because it is for redeeming now", async () => {
    const token = await createMagicLink(db, ELLIE, NOW);
    expect(await redeemMagicLink(db, token, NOW + 11 * MINUTE)).toBeNull();
  });

  it("still works just inside its window", async () => {
    const token = await createMagicLink(db, ELLIE, NOW);
    expect(await redeemMagicLink(db, token, NOW + 9 * MINUTE)).not.toBeNull();
  });

  it("refuses a token nobody issued", async () => {
    expect(await redeemMagicLink(db, "0".repeat(32), NOW)).toBeNull();
  });

  it("is long enough that guessing is not a strategy", async () => {
    const token = await createMagicLink(db, ELLIE, NOW);
    expect(token).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives every link a different token", async () => {
    const a = await createMagicLink(db, ELLIE, NOW);
    const b = await createMagicLink(db, ELLIE, NOW);
    expect(a).not.toBe(b);
  });
});

describe("sessions", () => {
  it("is found while it is alive", async () => {
    const token = await createMagicLink(db, ELLIE, NOW);
    const session = (await redeemMagicLink(db, token, NOW))!;
    expect(await findSession(db, session.id, NOW + 60_000)).toMatchObject({
      slackUserId: ELLIE,
    });
  });

  it("is gone after a day", async () => {
    const token = await createMagicLink(db, ELLIE, NOW);
    const session = (await redeemMagicLink(db, token, NOW))!;
    expect(await findSession(db, session.id, NOW + 25 * 60 * MINUTE)).toBeNull();
  });

  it("can be ended", async () => {
    const token = await createMagicLink(db, ELLIE, NOW);
    const session = (await redeemMagicLink(db, token, NOW))!;
    await endSession(db, session.id);
    expect(await findSession(db, session.id, NOW)).toBeNull();
  });

  it("refuses an empty id rather than matching something", async () => {
    expect(await findSession(db, "", NOW)).toBeNull();
  });

  it("says who you are, never what you may do", async () => {
    // A revoked user keeps a valid session and loses the ability to act,
    // because those are different questions.
    await grantWriteAccess(db, MAYA, ELLIE);
    const token = await createMagicLink(db, MAYA, NOW);
    const session = (await redeemMagicLink(db, token, NOW))!;

    await revokeWriteAccess(db, MAYA);

    expect(await findSession(db, session.id, NOW)).not.toBeNull();
    expect(await canWrite(db, MAYA, ELLIE)).toBe(false);
  });
});
