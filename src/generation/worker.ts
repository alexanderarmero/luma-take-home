import type { SqlClient } from "../db/client.js";
import {
  claimNextJob,
  markImagePosted,
  markImageStored,
  setJobState,
  type PipelineJob,
} from "../db/repository.js";
import type { ImageModel } from "../pricing.js";
import type { Block, SlackClient } from "../slack/client.js";
import type { ObjectStore } from "../storage/store.js";
import { GenerationError, type ImageGenerator } from "./generator.js";

export const APPROVE_ACTION_ID = "approve_image";
export const DISCARD_ACTION_ID = "discard_image";

/** Beyond this a job is failing for a reason retrying will not fix. */
const MAX_ATTEMPTS = 4;

export interface WorkerDeps {
  db: SqlClient;
  generator: ImageGenerator;
  store: ObjectStore;
  slack: SlackClient;
  channel: string;
  model: ImageModel;
  aspectRatio: string;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

export type StepResult = "worked" | "waiting" | "idle";

function decisionBlocks(job: PipelineJob): Block[] {
  const caption =
    job.kind === "pass_through"
      ? `*${job.filename}*\n_Original photo — no shot idea was given for this product, so nothing was changed._`
      : `*${job.filename}*`;

  const blocks: Block[] = [{ type: "section", text: { type: "mrkdwn", text: caption } }];

  if (job.prompt) {
    // A context block keeps the prompt visible without letting it compete with
    // the image in a stream that has to stay scannable.
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Prompt: ${job.prompt}` }],
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        action_id: APPROVE_ACTION_ID,
        text: { type: "plain_text", text: "Approve", emoji: true },
        style: "primary",
        value: job.imageId,
      },
      {
        type: "button",
        action_id: DISCARD_ACTION_ID,
        text: { type: "plain_text", text: "Discard", emoji: true },
        value: job.imageId,
      },
    ],
  });

  return blocks;
}

async function download(
  url: string,
  doFetch: typeof fetch,
): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await doFetch(url);
  if (!response.ok) {
    throw new GenerationError(`download failed: HTTP ${response.status}`, true);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "image/jpeg",
  };
}

/**
 * Advances exactly one job by exactly one stage, committing the transition
 * before returning.
 *
 * One stage per call is what makes a killed process resumable: whatever
 * committed stays committed, and the next boot picks the job up from there
 * rather than restarting it.
 */
export async function runOnce(deps: WorkerDeps, batchId?: number): Promise<StepResult> {
  const doFetch = deps.fetch ?? fetch;
  const log = deps.log ?? (() => {});
  const job = await claimNextJob(deps.db, batchId);
  if (!job) return "idle";

  try {
    switch (job.state) {
      case "pending_submit": {
        const { generationId, rateLimit } = await deps.generator.submit({
          prompt: job.prompt ?? "",
          sourceUrl: job.sourceUrl,
          model: deps.model,
          aspectRatio: deps.aspectRatio,
          userId: job.imageId,
        });
        await setJobState(deps.db, job.imageId, "submitted", { generationId });
        if (rateLimit.remaining !== undefined) {
          log(`[worker] rate limit remaining ${rateLimit.remaining}/${rateLimit.limit}`);
        }
        return "worked";
      }

      case "pending_fetch": {
        // A pass-through: the customer's own photo, copied into our store so
        // the batch does not depend on their host staying up. No generation,
        // no cost.
        const { bytes, contentType } = await download(job.sourceUrl, doFetch);
        const stored = await deps.store.put({
          bytes,
          contentType,
          filename: job.filename,
        });
        await markImageStored(deps.db, job.imageId, {
          objectKey: stored.key,
          checksum: stored.checksum,
        });
        return "worked";
      }

      case "submitted": {
        const result = await deps.generator.poll(job.generationId!);

        if (result.state === "pending") return "waiting";

        if (result.state === "failed") {
          if (result.retryable && job.attempts + 1 < MAX_ATTEMPTS) {
            await setJobState(deps.db, job.imageId, "pending_submit", {
              incrementAttempts: true,
              failureCode: result.failureCode,
              lastError: result.failureReason,
            });
            return "worked";
          }
          await setJobState(deps.db, job.imageId, "failed", {
            failureCode: result.failureCode,
            lastError: result.failureReason,
          });
          log(`[worker] ${job.filename} failed: ${result.failureCode}`);
          return "worked";
        }

        // Downloaded immediately. The output link expires in an hour, and
        // although re-polling would yield a fresh one, the bytes are what we
        // actually need to own.
        const { bytes, contentType } = await download(result.outputUrl, doFetch);
        const stored = await deps.store.put({
          bytes,
          contentType,
          filename: job.filename,
        });
        await markImageStored(deps.db, job.imageId, {
          objectKey: stored.key,
          checksum: stored.checksum,
        });
        return "worked";
      }

      case "stored": {
        const { bytes } = await deps.store.get(job.objectKey!);

        // Uploaded to Slack rather than referenced: the channel is the
        // permanent record and should not break if our storage does. The same
        // bytes go up that were stored — never a re-encode, so the file that
        // ships is provably the file that was approved.
        const { ts } = await deps.slack.uploadImage({
          channel: deps.channel,
          filename: job.filename,
          title: job.filename,
          bytes,
          blocks: decisionBlocks(job),
        });

        await markImagePosted(deps.db, job.imageId, ts ?? "");
        return "worked";
      }

      default:
        return "idle";
    }
  } catch (error) {
    const retryable = error instanceof GenerationError ? error.retryable : true;
    const attempts = job.attempts + 1;

    if (retryable && attempts < MAX_ATTEMPTS) {
      await setJobState(deps.db, job.imageId, job.state, {
        incrementAttempts: true,
        lastError: (error as Error).message,
      });
      log(`[worker] ${job.filename} attempt ${attempts} failed, will retry`);
      return "waiting";
    }

    await setJobState(deps.db, job.imageId, "failed", {
      lastError: (error as Error).message,
      incrementAttempts: true,
    });
    log(`[worker] ${job.filename} gave up: ${(error as Error).message}`);
    return "worked";
  }
}

/**
 * Runs jobs until nothing is left to do.
 *
 * `maxSteps` is a runaway guard, not a budget: a bug that never advances a job
 * would otherwise spin forever.
 */
export async function drain(
  deps: WorkerDeps,
  options: { maxSteps?: number; batchId?: number } = {},
): Promise<number> {
  const maxSteps = options.maxSteps ?? 5000;
  let worked = 0;

  for (let step = 0; step < maxSteps; step++) {
    const result = await runOnce(deps, options.batchId);
    if (result === "idle" || result === "waiting") return worked;
    worked += 1;
  }

  return worked;
}
