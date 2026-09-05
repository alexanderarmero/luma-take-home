import type { SqlClient } from "../db/client.js";
import type { Block } from "../slack/client.js";
import {
  canAdminister,
  grantWriteAccess,
  listWriteAccess,
  revokeWriteAccess,
} from "./store.js";

export const ACCESS_CALLBACK_ID = "manage_access";
export const ACCESS_ADD_BLOCK = "access_add";
export const ACCESS_ADD_ACTION = "access_add_users";
export const ACCESS_REVOKE_ACTION = "access_revoke";

/**
 * The access list, as a modal.
 *
 * A user picker rather than typed identifiers: a mistyped Slack ID simply
 * fails, where a mistyped email address would silently grant a stranger the
 * ability to approve.
 */
export async function buildAccessModal(
  db: SqlClient,
  approverUserId: string,
): Promise<Record<string, unknown>> {
  const entries = await listWriteAccess(db);

  const blocks: Block[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          "*Who can approve, discard and confirm*\n" +
          `<@${approverUserId}> always can, and can't be removed here.`,
      },
    },
    { type: "divider" },
  ];

  if (entries.length === 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: "_Nobody else has been given access yet._" }],
    });
  } else {
    for (const entry of entries) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `<@${entry.slackUserId}>` },
        accessory: {
          type: "button",
          action_id: `${ACCESS_REVOKE_ACTION}:${entry.slackUserId}`,
          text: { type: "plain_text", text: "Remove", emoji: true },
          style: "danger",
          value: entry.slackUserId,
        },
      });
    }
  }

  blocks.push(
    { type: "divider" },
    {
      type: "input",
      block_id: ACCESS_ADD_BLOCK,
      optional: true,
      label: { type: "plain_text", text: "Give access to" },
      element: {
        type: "multi_users_select",
        action_id: ACCESS_ADD_ACTION,
        placeholder: { type: "plain_text", text: "Pick people" },
      },
    },
  );

  return {
    type: "modal",
    callback_id: ACCESS_CALLBACK_ID,
    title: { type: "plain_text", text: "Review access" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Done" },
    blocks,
  };
}

export async function applyAccessChanges(
  db: SqlClient,
  input: { actorUserId: string; approverUserId: string; addUserIds: string[] },
): Promise<{ ok: boolean; reason?: string }> {
  if (!canAdminister(input.actorUserId, input.approverUserId)) {
    return { ok: false, reason: "Only the configured approver can change this list." };
  }
  for (const userId of input.addUserIds) {
    // Granting the approver a row would be harmless but misleading: they have
    // access by configuration, not by grant.
    if (userId === input.approverUserId) continue;
    await grantWriteAccess(db, userId, input.actorUserId);
  }
  return { ok: true };
}

export async function revokeIfPermitted(
  db: SqlClient,
  input: { actorUserId: string; approverUserId: string; targetUserId: string },
): Promise<{ ok: boolean; reason?: string }> {
  if (!canAdminister(input.actorUserId, input.approverUserId)) {
    return { ok: false, reason: "Only the configured approver can change this list." };
  }
  if (input.targetUserId === input.approverUserId) {
    return { ok: false, reason: "You can't remove your own access." };
  }
  await revokeWriteAccess(db, input.targetUserId);
  return { ok: true };
}
