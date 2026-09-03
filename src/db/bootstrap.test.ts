import { describe, expect, it, vi } from "vitest";
import { createDbBootstrap } from "./bootstrap.js";
import type { SqlClient } from "./client.js";

const noSleep = () => Promise.resolve();

function fakeDb(): SqlClient {
  return {
    query: async () => ({ rows: [] }),
    exec: async () => {},
    transaction: async (fn) => fn(fakeDb()),
  };
}

describe("createDbBootstrap", () => {
  it("starts out reporting that it has not connected yet", () => {
    const boot = createDbBootstrap(fakeDb(), { migrate: vi.fn(), sleep: noSleep });
    expect(boot.status().state).toBe("connecting");
  });

  it("reports ready once migrations succeed", async () => {
    const migrate = vi.fn().mockResolvedValue(["0001_initial"]);
    const boot = createDbBootstrap(fakeDb(), { migrate, sleep: noSleep });
    await boot.start();
    expect(boot.status()).toMatchObject({ state: "ready", attempts: 1 });
  });

  it("retries a connection that is not up yet", async () => {
    // Railway's private network takes a few seconds to come up after the
    // container starts, so the first connection attempt routinely loses.
    const migrate = vi
      .fn()
      .mockRejectedValueOnce(new Error("ENOTFOUND postgres.railway.internal"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue([]);

    const boot = createDbBootstrap(fakeDb(), { migrate, sleep: noSleep });
    await boot.start();

    expect(migrate).toHaveBeenCalledTimes(3);
    expect(boot.status()).toMatchObject({ state: "ready", attempts: 3 });
  });

  it("gives up after the attempt budget and keeps the reason visible", async () => {
    const migrate = vi.fn().mockRejectedValue(new Error("password authentication failed"));
    const boot = createDbBootstrap(fakeDb(), {
      migrate,
      sleep: noSleep,
      maxAttempts: 3,
    });

    await boot.start();

    const status = boot.status();
    expect(status.state).toBe("error");
    // The whole point: the reason survives to somewhere a human can read it.
    expect(status.detail).toContain("password authentication failed");
    expect(status.attempts).toBe(3);
  });

  it("does not throw, so a database problem cannot take the web server down", async () => {
    const migrate = vi.fn().mockRejectedValue(new Error("boom"));
    const boot = createDbBootstrap(fakeDb(), {
      migrate,
      sleep: noSleep,
      maxAttempts: 1,
    });
    await expect(boot.start()).resolves.toBeUndefined();
  });

  it("backs off further with each attempt", async () => {
    const delays: number[] = [];
    const migrate = vi.fn().mockRejectedValue(new Error("nope"));
    const boot = createDbBootstrap(fakeDb(), {
      migrate,
      maxAttempts: 4,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    await boot.start();
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBeGreaterThan(1);
  });
});
