import type { SqlClient } from "./client.js";
import { migrate as defaultMigrate } from "./migrate.js";

export type DbState = "connecting" | "ready" | "error";

export interface DbStatus {
  state: DbState;
  attempts: number;
  detail?: string;
}

export interface BootstrapOptions {
  migrate?: (db: SqlClient) => Promise<string[]>;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  log?: (message: string) => void;
}

const BASE_DELAY_MS = 500;

/**
 * Brings the database up alongside the web server rather than ahead of it.
 *
 * Running migrations before `serve()` means any database problem kills the
 * process before the health endpoint exists — so the service is simultaneously
 * down and undiagnosable, which is the worst of both. Here the server answers
 * immediately and reports what the database is doing.
 *
 * Retries exist because a private network typically is not routable for the
 * first few seconds of a container's life. A first attempt that fails is
 * normal, not an error.
 */
export function createDbBootstrap(db: SqlClient, options: BootstrapOptions = {}) {
  const {
    migrate = defaultMigrate,
    sleep = (ms: number) => new Promise((r) => setTimeout(r, ms)),
    maxAttempts = 8,
    log = console.log,
  } = options;

  let status: DbStatus = { state: "connecting", attempts: 0 };

  return {
    status: (): DbStatus => status,

    /** Never rejects: a database failure must not take the web server down. */
    start: async (): Promise<void> => {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const applied = await migrate(db);
          status = { state: "ready", attempts: attempt };
          log(
            applied.length > 0
              ? `[db] ready — applied migrations: ${applied.join(", ")}`
              : "[db] ready",
          );
          return;
        } catch (error) {
          const detail = (error as Error).message;
          status = { state: "error", attempts: attempt, detail };

          if (attempt === maxAttempts) {
            log(`[db] giving up after ${attempt} attempts: ${detail}`);
            return;
          }

          const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
          log(`[db] attempt ${attempt} failed (${detail}); retrying in ${delay}ms`);
          await sleep(delay);
        }
      }
    },
  };
}
