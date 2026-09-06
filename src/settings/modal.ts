import type { SqlClient } from "../db/client.js";
import {
  getPromptDirection,
  MAX_DIRECTION_LENGTH,
  type PromptDirection,
} from "./prompt.js";

export const PROMPT_CALLBACK_ID = "system_prompt";
export const PROMPT_BLOCK_ID = "system_prompt_text";
export const PROMPT_ACTION_ID = "system_prompt_input";

/**
 * The system prompt, shown as it is actually sent.
 *
 * Only the direction is editable. The block above it is read out of the
 * catalog on every batch — palette, materials, the team's own phrasing — so
 * showing it as text you could edit would be a lie about what happens next.
 */
export async function buildPromptModal(db: SqlClient): Promise<Record<string, unknown>> {
  const current = await getPromptDirection(db);

  return {
    type: "modal",
    callback_id: PROMPT_CALLBACK_ID,
    title: { type: "plain_text", text: "System prompt" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: describe(current) },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text:
              "Above this, every request also carries the brand's palette, " +
              "materials and the way your team writes shot ideas — read from " +
              "the catalog you upload, so it changes with the file rather " +
              "than with this box.",
          },
        ],
      },
      { type: "divider" },
      {
        type: "input",
        block_id: PROMPT_BLOCK_ID,
        optional: true,
        label: { type: "plain_text", text: "Direction" },
        hint: {
          type: "plain_text",
          text: "Clear the box and save to go back to the built-in wording.",
        },
        element: {
          type: "plain_text_input",
          action_id: PROMPT_ACTION_ID,
          multiline: true,
          max_length: MAX_DIRECTION_LENGTH,
          initial_value: current.text,
        },
      },
    ],
  };
}

function describe(current: PromptDirection): string {
  if (!current.isOverride) {
    return (
      "*This is the built-in wording.* It's what tells the writer to make the " +
      "three shots genuinely different rather than reworded, and to keep at " +
      "least one restrained.\n\nChanges take effect on the *next* batch. " +
      "Photos already generated are never re-made."
    );
  }
  const who = current.updatedBy ? ` by <@${current.updatedBy}>` : "";
  return (
    `*This has been changed${who}.*\n\nChanges take effect on the *next* ` +
    "batch. Photos already generated are never re-made."
  );
}
