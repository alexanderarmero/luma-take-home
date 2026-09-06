import type { SqlClient } from "../db/client.js";
import {
  addRegeneratedImage,
  getRegenerationTarget,
} from "../db/repository.js";
import { buildFilename } from "./filename.js";

/** Long enough to describe a scene, short enough not to be a system prompt. */
export const MAX_PROMPT_LENGTH = 1000;

export type RegenerateOutcome =
  | { ok: true; imageId: string; slot: number; filename: string }
  | { ok: false; reason: string };

export interface RegenerateInput {
  db: SqlClient;
  /** The photo being reacted to — the new one is added beside it, not over it. */
  imageId: string;
  prompt: string;
}

/**
 * Asks for one more shot of a product, from a prompt somebody wrote themselves.
 *
 * Three deliberate differences from the batch path:
 *
 * 1. **One shot, not three.** The batch makes three because nobody has said
 *    what they want yet and variety is the answer to that. Here somebody has
 *    said exactly what they want, so making three would be spending twice as
 *    much to ignore two of them.
 * 2. **No prompt writing.** The text is used as written. Passing a considered
 *    instruction through a model that rewrites it is the one thing guaranteed
 *    to lose what made it considered.
 * 3. **Appended, never substituted.** The photo it was asked from stays where
 *    it is, decided or not.
 */
export async function regenerate(input: RegenerateInput): Promise<RegenerateOutcome> {
  const prompt = input.prompt.trim();

  if (prompt === "") {
    return {
      ok: false,
      reason: "Write what you want to see — this one isn't rewritten for you.",
    };
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      reason: `That's ${prompt.length} characters; the limit is ${MAX_PROMPT_LENGTH}.`,
    };
  }

  const target = await getRegenerationTarget(input.db, input.imageId);
  if (!target) return { ok: false, reason: "That photo doesn't exist." };

  if (target.frozen) {
    return {
      ok: false,
      reason:
        "This batch has been confirmed and handed over. Adding to it now " +
        "would change what the web person was given.",
    };
  }

  // The new photo is posted into the product's existing thread, and there
  // isn't one until the first set has been posted. Without this the shot
  // would be generated and then have nowhere to go.
  if (!target.messageTs) {
    return {
      ok: false,
      reason:
        "This product's photos haven't been posted yet. Wait for its thread " +
        "to appear, then ask for another.",
    };
  }

  const created = await addRegeneratedImage(input.db, {
    batchId: target.batchId,
    sku: target.sku,
    productName: target.productName,
    prompt,
    filenameFor: (slot) => buildFilename({ sku: target.sku, slot, shotIdea: prompt }),
  });

  return { ok: true, ...created };
}
