import { MAX_PROMPT_LENGTH } from "./oneoff.js";

export const ONEOFF_CALLBACK_ID = "oneoff_generate";
export const ONEOFF_FILE_BLOCK = "oneoff_file";
export const ONEOFF_FILE_ACTION = "oneoff_file_input";
export const ONEOFF_PROMPT_BLOCK = "oneoff_prompt";
export const ONEOFF_PROMPT_ACTION = "oneoff_prompt_input";

/**
 * One photo, from your own image and your own words.
 *
 * Says plainly that the result is private and disposable, because the rest of
 * this app is about photographs the team reviews and publishes — and something
 * that looks the same but isn't part of that is worth labelling.
 */
export function buildOneOffModal(): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: ONEOFF_CALLBACK_ID,
    title: { type: "plain_text", text: "One-off shot" },
    submit: { type: "plain_text", text: "Make it" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "Try an idea on a single photo. The result comes back in your " +
            "conversation with me — it isn't part of any batch, nobody " +
            "reviews it, and it is never published.",
        },
      },
      {
        type: "input",
        block_id: ONEOFF_FILE_BLOCK,
        label: { type: "plain_text", text: "Photo" },
        element: {
          type: "file_input",
          action_id: ONEOFF_FILE_ACTION,
          filetypes: ["jpg", "jpeg", "png", "webp"],
          max_files: 1,
        },
      },
      {
        type: "input",
        block_id: ONEOFF_PROMPT_BLOCK,
        label: { type: "plain_text", text: "What do you want to see?" },
        hint: {
          type: "plain_text",
          text: "Used exactly as written — nothing rewrites it.",
        },
        element: {
          type: "plain_text_input",
          action_id: ONEOFF_PROMPT_ACTION,
          multiline: true,
          max_length: MAX_PROMPT_LENGTH,
          placeholder: {
            type: "plain_text",
            text: "On a sunlit windowsill, linen curtain, early morning.",
          },
        },
      },
    ],
  };
}
