import {
  batchOutcome,
  ensureReviewToken,
  findBatchesAwaitingAnnouncement,
  setBatchState,
} from "../db/repository.js";
import { buildGeneratedCatalog } from "../export/catalog.js";
import { drain, type WorkerDeps } from "./worker.js";

export interface LoopOptions {
  intervalMs?: number;
  approverUserId?: string;
  /** Absolute base for the image links written into the catalog export. */
  publicBaseUrl?: string;
  /** Bounds a single tick in tests; production wants no ceiling. */
  maxStepsPerTick?: number;
}

/**
 * One tick: run whatever work exists, then announce any batch that has just
 * finished.
 *
 * Announcing from here rather than from the request that pressed Generate is
 * what makes it survive a restart. A deferred task dies with its process; a
 * batch sitting in the database does not.
 */
export async function tick(deps: WorkerDeps, options: LoopOptions = {}): Promise<number> {
  const worked = await drain(deps, {
    ...(options.maxStepsPerTick === undefined ? {} : { maxSteps: options.maxStepsPerTick }),
  });

  for (const batchId of await findBatchesAwaitingAnnouncement(deps.db)) {
    const outcome = await batchOutcome(deps.db, batchId);
    await setBatchState(deps.db, batchId, "ready_for_review");
    // The decision surface is the page now, so the summons has to carry it.
    const reviewToken = await ensureReviewToken(deps.db, batchId);

    const lines = [
      `${options.approverUserId ? `<@${options.approverUserId}> ` : ""}` +
        `*Batch #${batchId} is ready for review.*`,
      "",
      `*${outcome.posted}* photos are above, each waiting on an approve or a ` +
        "discard.",
      ...(options.publicBaseUrl && reviewToken
        ? ["", `Decide on them here: ${options.publicBaseUrl}/review/${reviewToken}`]
        : []),
    ];

    // A photograph that arrived but never reached the channel is only on the
    // page. Silence here would send someone scrolling the thread for it, and
    // it would sit undecided because nobody knew it was waiting.
    if (outcome.unposted > 0) {
      lines.push(
        "",
        `*${outcome.unposted}* arrived but couldn't be posted here — they're ` +
          "on the review page, waiting on you like the rest.",
      );
    }

    // Reported, not omitted. A photo that never arrives is otherwise
    // indistinguishable from one still on its way, and the team would wait
    // for something that is never coming.
    if (outcome.failed > 0) {
      lines.push(
        "",
        `*${outcome.failed}* didn't arrive and aren't above. ` +
          "Run `/luma status` to see which products came up short.",
      );
    }

    await deps.slack.postMessage({ channel: deps.channel, text: lines.join("\n") });

    // The catalog with a column per shot, so the sheet reflects what was made.
    if (options.publicBaseUrl) {
      const csv = await buildGeneratedCatalog(deps.db, batchId, options.publicBaseUrl);
      await deps.slack.uploadFile({
        channel: deps.channel,
        filename: csv.filename,
        title: csv.filename,
        bytes: Buffer.from(csv.content, "utf8"),
      });
    }
  }

  return worked;
}

/**
 * Runs the pipeline continuously in the background.
 *
 * This is the resume mechanism. Work lives in the job table, so a restart
 * loses nothing but time — the next tick picks up whatever was in flight,
 * including generations submitted by a process that no longer exists.
 */
export function startWorkerLoop(deps: WorkerDeps, options: LoopOptions = {}) {
  const intervalMs = options.intervalMs ?? 5_000;
  let stopped = false;
  let running = false;

  const run = async () => {
    // Overlapping ticks would double-execute jobs: there is one worker by
    // design, and that has to hold across timers too.
    if (stopped || running) return;
    running = true;
    try {
      await tick(deps, options);
    } catch (error) {
      deps.log?.(`[worker] tick failed: ${(error as Error).message}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();
  void run();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
