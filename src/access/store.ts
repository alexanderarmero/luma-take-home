import { randomBytes } from "node:crypto";
import type { SqlClient } from "../db/client.js";

/** Long enough that guessing is not a strategy; matches the batch token. */
const TOKEN_BYTES = 16;

/** A link is for redeeming now, not later. */
const LINK_LIFETIME_MS = 10 * 60 * 1000;
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface AccessEntry {
  slackUserId: string;
  grantedBy: string;
  grantedAt: Date;
}

export async function listWriteAccess(db: SqlClient): Promise<AccessEntry[]> {
  const { rows } = await db.query<{
    slack_user_id: string;
    granted_by: string;
    granted_at: Date;
  }>(`select slack_user_id, granted_by, granted_at from write_access order by granted_at`);
  return rows.map((r) => ({
    slackUserId: r.slack_user_id,
    grantedBy: r.granted_by,
    grantedAt: r.granted_at,
  }));
}

export async function grantWriteAccess(
  db: SqlClient,
  slackUserId: string,
  grantedBy: string,
): Promise<void> {
  await db.query(
    `insert into write_access (slack_user_id, granted_by) values ($1, $2)
     on conflict (slack_user_id) do nothing`,
    [slackUserId, grantedBy],
  );
}

export async function revokeWriteAccess(
  db: SqlClient,
  slackUserId: string,
): Promise<void> {
  await db.query(`delete from write_access where slack_user_id = $1`, [slackUserId]);
}

/**
 * Whether this person may act.
 *
 * The configured approver always may, without a row — otherwise revoking the
 * last granted user would lock the team out with no way back but a redeploy.
 */
export async function canWrite(
  db: SqlClient,
  slackUserId: string,
  approverUserId: string,
): Promise<boolean> {
  if (!slackUserId) return false;
  if (slackUserId === approverUserId) return true;

  const { rows } = await db.query(
    `select 1 from write_access where slack_user_id = $1`,
    [slackUserId],
  );
  return rows.length > 0;
}

/** Only the configured approver administers the list. */
export function canAdminister(slackUserId: string, approverUserId: string): boolean {
  return Boolean(slackUserId) && slackUserId === approverUserId;
}

export async function createMagicLink(
  db: SqlClient,
  slackUserId: string,
  nowMs: number,
): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  await db.query(
    `insert into magic_links (token, slack_user_id, expires_at)
     values ($1, $2, $3)`,
    [token, slackUserId, new Date(nowMs + LINK_LIFETIME_MS)],
  );
  return token;
}

export interface Session {
  id: string;
  slackUserId: string;
}

/**
 * Trades a link for a session, once.
 *
 * The used_at guard is applied in the update itself, so two simultaneous
 * redemptions cannot both succeed.
 */
export async function redeemMagicLink(
  db: SqlClient,
  token: string,
  nowMs: number,
): Promise<Session | null> {
  const now = new Date(nowMs);

  const { rows } = await db.query<{ slack_user_id: string }>(
    `update magic_links set used_at = $2
      where token = $1 and used_at is null and expires_at > $2
      returning slack_user_id`,
    [token, now],
  );

  const slackUserId = rows[0]?.slack_user_id;
  if (!slackUserId) return null;

  const id = randomBytes(TOKEN_BYTES).toString("hex");
  await db.query(
    `insert into sessions (id, slack_user_id, expires_at) values ($1, $2, $3)`,
    [id, slackUserId, new Date(nowMs + SESSION_LIFETIME_MS)],
  );
  return { id, slackUserId };
}

export async function findSession(
  db: SqlClient,
  sessionId: string,
  nowMs: number,
): Promise<Session | null> {
  if (!sessionId) return null;
  const { rows } = await db.query<{ id: string; slack_user_id: string }>(
    `select id, slack_user_id from sessions where id = $1 and expires_at > $2`,
    [sessionId, new Date(nowMs)],
  );
  const row = rows[0];
  return row ? { id: row.id, slackUserId: row.slack_user_id } : null;
}

export async function endSession(db: SqlClient, sessionId: string): Promise<void> {
  await db.query(`delete from sessions where id = $1`, [sessionId]);
}
