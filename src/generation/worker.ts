import type { SqlClient } from "../db/client.js";
import {
  claimNextJob,
  countInFlightGenerations,
  ensureReviewToken,
  getProductImages,
  getProductThread,
  markImagePosted,
  markImageStored,
  setJobState,
  setProductMessageTs,
  type PipelineJob,
} from "../db/repository.js";
import type { ImageModel } from "../pricing.js";
import type { SlackClient } from "../slack/client.js";
import type { ObjectStore } from "../storage/store.js";
import { LUMA_CONCURRENT_GENERATIONS } from "./capacity.js";
import { GenerationError, type ImageGenerator } from "./generator.js";
import { noopObserver, type Observer } from "./observe.js";
import {
  buildCandidateBlocks,
  buildFailureNote,
  buildProductChannelMessage,
} from "./message.js";

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
  /** Absolute base for the review links written into Slack. */
  publicBaseUrl?: string;
  fetch?: typeof fetch;
  log?: (message: string) => void;
  /** Injected so the poll loop can be driven without real time in tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Overridable because the account's capacity is not ours to hardcode. */
  maxConcurrentGenerations?: number;
  /**
   * One structured line per pipeline failure.
   *
   * Separate from the Luma observer because most of this pipeline never calls
   * Luma: a pass-through is a download, a write and a Slack post. Those stages
   * had no instrumentation at all, which is why nineteen of them could fail in
   * one batch with no recorded cause anywhere.
   */
  observe?: Observer;
}

export type StepResult =
  /** A stage was completed and committed. */
  | { kind: "worked" }
  /** Nothing to do for this image yet — its generation is still running. */
  | { kind: "waiting"; imageId: string }
  /**
   * Work remains, but Luma will not accept another generation until one of
   * ours finishes. Distinct from "waiting", which is about one image; this is
   * about the account.
   */
  | { kind: "at_capacity"; inFlight: number }
  /** No job is available at all. */
  | { kind: "idle" };

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
export async function runOnce(
  deps: WorkerDeps,
  batchId?: number,
  excludeImageIds: string[] = [],
): Promise<StepResult> {
  const doFetch = deps.fetch ?? fetch;
  const log = deps.log ?? (() => {});

  // Asked before claiming, so a job we could not start is never claimed and
  // then put back. Polling and posting stay available at capacity — they are
  // what frees it.
  const capacity = deps.maxConcurrentGenerations ?? LUMA_CONCURRENT_GENERATIONS;
  const inFlight = await countInFlightGenerations(deps.db);
  const allowSubmit = inFlight < capacity;

  const job = await claimNextJob(deps.db, batchId, excludeImageIds, allowSubmit);
  if (!job) {
    // Nothing claimable. If that is only because we are at capacity, the batch
    // is not finished — it is waiting for room.
    if (!allowSubmit) {
      log(`[worker] at capacity: ${inFlight}/${capacity} generations running`);
      return { kind: "at_capacity", inFlight };
    }
    return { kind: "idle" };
  }

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
        return { kind: "worked" };
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
        return { kind: "worked" };
      }

      case "submitted": {
        const result = await deps.generator.poll(job.generationId!);

        if (result.state === "pending") return { kind: "waiting", imageId: job.imageId };

        if (result.state === "failed") {
          if (result.retryable && job.attempts + 1 < MAX_ATTEMPTS) {
            await setJobState(deps.db, job.imageId, "pending_submit", {
              incrementAttempts: true,
              failureCode: result.failureCode,
              lastError: result.failureReason,
            });
            return { kind: "worked" };
          }
          await setJobState(deps.db, job.imageId, "failed", {
            failureCode: result.failureCode,
            lastError: result.failureReason,
          });
          log(`[worker] ${job.filename} failed: ${result.failureCode}`);
          return { kind: "worked" };
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
        return { kind: "worked" };
      }

      case "stored": {
        // The sibling gate means every candidate for this product has settled
        // by now, so the whole set goes out together: one line in the channel,
        // and the photographs in its thread.
        const product = await getProductImages(deps.db, job.batchId, job.sku);

        const reviewToken = await ensureReviewToken(deps.db, job.batchId);
        const channelMessage = buildProductChannelMessage({
          sku: job.sku,
          productName: product.productName,
          shotIdea: product.shotIdea,
          images: product.images,
          ...(deps.publicBaseUrl
            ? {
                reviewUrl: `${deps.publicBaseUrl}/review/${reviewToken}#p-${job.sku}`,
              }
            : {}),
        });

        // A product posts its line once. A regenerated shot arriving later
        // joins that conversation rather than starting a second one about the
        // same product.
        const existing = await getProductThread(deps.db, job.batchId, job.sku);
        let threadTs: string;

        if (existing.messageTs) {
          threadTs = existing.messageTs;
          // Redrawn so the line's counts include the shot about to arrive.
          await deps.slack.updateMessage({
            channel: deps.channel,
            ts: threadTs,
            text: channelMessage.text,
            blocks: channelMessage.blocks,
          });
        } else {
          const posted = await deps.slack.postMessage({
            channel: deps.channel,
            text: channelMessage.text,
            blocks: channelMessage.blocks,
          });
          threadTs = posted.ts;

          // Captured now rather than at render time: the overview links
          // straight into this product's conversation, and doing it here costs
          // one call per product instead of one per page view.
          let permalink: string | undefined;
          try {
            permalink = await deps.slack.getPermalink(deps.channel, threadTs);
          } catch {
            // A missing link costs a button on the page, not the batch.
          }
          await setProductMessageTs(deps.db, job.batchId, job.sku, threadTs, permalink);
        }

        // Each candidate is its own file share inside that thread: the bytes
        // live in Slack, so the record survives our storage, and a decision
        // sits directly under the image it belongs to.
        for (const image of product.images) {
          if (image.jobState !== "stored" || !image.objectKey) continue;

          const { bytes } = await deps.store.get(image.objectKey);
          const { ts } = await deps.slack.uploadFile({
            channel: deps.channel,
            threadTs,
            filename: image.filename,
            title: image.filename,
            bytes,
            blocks: buildCandidateBlocks(image),
          });
          await markImagePosted(deps.db, image.imageId, ts ?? "");
        }

        // Only when the thread is new. On an append the note would be
        // reposted every time, saying the same thing about the same failures.
        const failed = existing.messageTs
          ? []
          : product.images.filter((i) => i.jobState === "failed");
        if (failed.length > 0) {
          await deps.slack.postMessage({
            channel: deps.channel,
            threadTs,
            text: `${failed.length} of ${product.images.length} didn't arrive`,
            blocks: buildFailureNote(failed, product.images.length),
          });
        }

        return { kind: "worked" };
      }

      default:
        return { kind: "idle" };
    }
  } catch (error) {
    const retryable = error instanceof GenerationError ? error.retryable : true;
    const throttled = error instanceof GenerationError && error.throttled;

    // The stage is the whole diagnosis. "attempt 1 failed" on a pass-through
    // could be the source photo, our bucket, or Slack refusing the post, and
    // those have nothing to do with each other.
    const observe = deps.observe ?? noopObserver;
    observe({
      event: "pipeline.error",
      stage: job.state,
      kind: job.kind,
      imageId: job.imageId,
      filename: job.filename,
      sku: job.sku,
      attempt: job.attempts + 1,
      throttled,
      retryable,
      message: (error as Error).message,
    });

    // Being told to slow down is not this photograph's fault, so it does not
    // spend one of its four attempts. Without this a busy batch converts its
    // own impatience into permanent failures: four refusals in a few seconds
    // and an image that would have generated perfectly well is marked as
    // never having arrived.
    if (throttled) {
      log(`[worker] ${job.filename} throttled, will retry without penalty`);
      await setJobState(deps.db, job.imageId, job.state, {
        lastError: (error as Error).message,
      });
      return { kind: "waiting", imageId: job.imageId };
    }

    const attempts = job.attempts + 1;

    if (retryable && attempts < MAX_ATTEMPTS) {
      await setJobState(deps.db, job.imageId, job.state, {
        incrementAttempts: true,
        lastError: (error as Error).message,
      });
      // The message, not just the count. A pass-through makes no Luma call at
      // all, so its failures appear in no request log — without this they were
      // invisible everywhere except a database column nobody was reading.
      log(
        `[worker] ${job.filename} attempt ${attempts} failed, will retry: ` +
          `${(error as Error).message}`,
      );
      return { kind: "waiting", imageId: job.imageId };
    }

    await setJobState(deps.db, job.imageId, "failed", {
      lastError: (error as Error).message,
      incrementAttempts: true,
    });
    log(`[worker] ${job.filename} gave up: ${(error as Error).message}`);
    return { kind: "worked" };
  }
}

/**
 * Runs a batch to completion.
 *
 * The subtlety is that a job can be *waiting* rather than finished: a real
 * generation takes a while, and polling it returns "still running". An earlier
 * version treated that as "nothing more to do" and returned — which, against
 * the real API, submitted the first image and stopped. Every fake in the tests
 * completed instantly, so nothing caught it.
 *
 * So waiting images are set aside, the rest of the batch carries on, and once
 * only waiting images remain the loop sleeps and re-polls them. Luma documents
 * 2–5 seconds as a safe cadence.
 */
export async function drain(
  deps: WorkerDeps,
  options: {
    maxSteps?: number;
    batchId?: number;
    pollIntervalMs?: number;
  } = {},
): Promise<number> {
  const maxSteps = options.maxSteps ?? 100_000;
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const waiting = new Set<string>();
  let worked = 0;

  for (let step = 0; step < maxSteps; step++) {
    const result = await runOnce(deps, options.batchId, [...waiting]);

    if (result.kind === "worked") {
      worked += 1;
      continue;
    }

    if (result.kind === "waiting") {
      waiting.add(result.imageId);
      continue;
    }

    // Room is freed by a generation finishing, which we learn by polling, so
    // the only thing to do is wait and look again. Not added to `waiting`:
    // this is the account's state, not any one image's.
    if (result.kind === "at_capacity") {
      await sleep(pollIntervalMs);
      waiting.clear();
      continue;
    }

    // Nothing actionable left. If anything is merely waiting, give it time and
    // look again; otherwise the batch is genuinely done.
    if (waiting.size === 0) return worked;
    await sleep(pollIntervalMs);
    waiting.clear();
  }

  deps.log?.(`[worker] stopped after ${maxSteps} steps — this should not happen`);
  return worked;
}
