import { batchCounts, findBatchesAwaitingAnnouncement, setBatchState } from "../db/repository.js";
import { drain, type WorkerDeps } from "./worker.js";

export interface LoopOptions {
  intervalMs?: number;
  approverUserId?: string;
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
    const counts = await batchCounts(deps.db, batchId);
    await setBatchState(deps.db, batchId, "ready_for_review");
    await deps.slack.postMessage({
      channel: deps.channel,
      text:
        `${options.approverUserId ? `<@${options.approverUserId}> ` : ""}` +
        `Batch #${batchId} is ready for review. ${counts.total} images are above, ` +
        `each needing an Approve or a Discard.`,
    });
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
