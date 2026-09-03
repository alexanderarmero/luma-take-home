import { describe, expect, it, vi } from "vitest";

/**
 * A pool that records which connection each statement ran on.
 *
 * This is the one place a fake database earns its keep: the bug it guards
 * against — issuing BEGIN, the body, and COMMIT on three different pooled
 * connections — is invisible to PGlite, which only ever has one connection.
 */
const calls: Array<{ connection: number; text: string }> = [];
let released = 0;
let connectionCounter = 0;

vi.mock("pg", () => {
  class FakePool {
    async connect() {
      const connection = ++connectionCounter;
      return {
        query: async (text: string) => {
          calls.push({ connection, text });
          return { rows: [] };
        },
        release: () => {
          released += 1;
        },
      };
    }
    async query(text: string) {
      calls.push({ connection: 0, text }); // 0 = "whatever the pool handed out"
      return { rows: [] };
    }
    async end() {}
  }
  return { default: { Pool: FakePool } };
});

const { createPostgresClient } = await import("./postgres.js");

function reset() {
  calls.length = 0;
  released = 0;
  connectionCounter = 0;
}

describe("createPostgresClient.transaction", () => {
  it("runs begin, the body, and commit on one connection", async () => {
    reset();
    const db = createPostgresClient("postgres://ignored");

    await db.transaction(async (tx) => {
      await tx.query("delete from discarded_images where image_id = $1", ["x"]);
      await tx.query("insert into approved_images values ($1)", ["x"]);
    });

    expect(calls.map((c) => c.text.split(" ")[0])).toEqual([
      "begin",
      "delete",
      "insert",
      "commit",
    ]);
    const connections = new Set(calls.map((c) => c.connection));
    expect(connections.size).toBe(1);
    expect([...connections][0]).not.toBe(0); // never the bare pool
  });

  it("releases the connection back to the pool", async () => {
    reset();
    const db = createPostgresClient("postgres://ignored");
    await db.transaction(async () => {});
    expect(released).toBe(1);
  });

  it("rolls back and still releases when the body throws", async () => {
    reset();
    const db = createPostgresClient("postgres://ignored");

    await expect(
      db.transaction(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(calls.map((c) => c.text)).toEqual(["begin", "rollback"]);
    // A connection left checked out — or worse, returned idle-in-transaction —
    // poisons every later caller that happens to be handed it.
    expect(released).toBe(1);
  });

  it("does not open a second connection for a nested transaction", async () => {
    reset();
    const db = createPostgresClient("postgres://ignored");
    await db.transaction(async (tx) => {
      await tx.transaction(async (inner) => {
        await inner.query("select 1");
      });
    });
    expect(connectionCounter).toBe(1);
    expect(calls.filter((c) => c.text === "begin")).toHaveLength(1);
  });
});
