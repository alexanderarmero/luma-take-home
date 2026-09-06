import type { SqlClient } from "../db/client.js";
import { DEFAULT_DIRECTION } from "../generation/brand.js";

const KEY = "prompt_direction";

/** The longest an override may be, in characters. */
export const MAX_DIRECTION_LENGTH = 4000;

export interface PromptDirection {
  text: string;
  /** False when this is the built-in, so the UI can say which you're looking at. */
  isOverride: boolean;
  updatedBy: string | null;
  updatedAt: Date | null;
}

/**
 * The direction half of the system prompt, overridden or not.
 *
 * Absence means the default, rather than a copy of the default written into
 * the row at install time — otherwise improving the built-in would silently
 * fail to reach anyone who had ever opened the modal.
 */
export async function getPromptDirection(db: SqlClient): Promise<PromptDirection> {
  const { rows } = await db.query<{
    value: string;
    updated_by: string | null;
    updated_at: Date;
  }>(`select value, updated_by, updated_at from settings where key = $1`, [KEY]);

  const row = rows[0];
  if (!row) {
    return {
      text: DEFAULT_DIRECTION,
      isOverride: false,
      updatedBy: null,
      updatedAt: null,
    };
  }
  return {
    text: row.value,
    isOverride: true,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export type SaveOutcome =
  | { ok: true; reverted: boolean }
  | { ok: false; reason: string };

/**
 * Saves an override, or removes one.
 *
 * Blank means revert, deliberately: it is the same gesture as clearing a field,
 * and it makes "get me back to the default" something you can do without
 * remembering what the default said.
 */
export async function savePromptDirection(
  db: SqlClient,
  input: { text: string; byUserId: string },
): Promise<SaveOutcome> {
  const text = input.text.trim();

  if (text === "") {
    await db.query(`delete from settings where key = $1`, [KEY]);
    return { ok: true, reverted: true };
  }

  if (text.length > MAX_DIRECTION_LENGTH) {
    return {
      ok: false,
      reason:
        `That's ${text.length} characters and the limit is ` +
        `${MAX_DIRECTION_LENGTH}. Every prompt call carries this text, so a ` +
        "long one costs money on every product.",
    };
  }

  await db.query(
    `insert into settings (key, value, updated_by, updated_at)
     values ($1, $2, $3, now())
     on conflict (key) do update
       set value = excluded.value,
           updated_by = excluded.updated_by,
           updated_at = now()`,
    [KEY, text, input.byUserId],
  );
  return { ok: true, reverted: false };
}
