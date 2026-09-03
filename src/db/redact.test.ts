import { describe, expect, it } from "vitest";
import { describeDatabaseUrl } from "./redact.js";

describe("describeDatabaseUrl", () => {
  it("names the host, port and database", () => {
    expect(
      describeDatabaseUrl("postgresql://postgres:hunter2@postgres.railway.internal:5432/railway"),
    ).toBe("postgres@postgres.railway.internal:5432/railway");
  });

  it("never includes the password", () => {
    const described = describeDatabaseUrl(
      "postgresql://postgres:sup3r-s3cret@switchback.proxy.rlwy.net:24273/railway",
    );
    expect(described).not.toContain("sup3r-s3cret");
    expect(described).toContain("switchback.proxy.rlwy.net:24273");
  });

  it("handles a URL with no credentials", () => {
    expect(describeDatabaseUrl("postgresql://localhost:5432/dev")).toBe(
      "localhost:5432/dev",
    );
  });

  it("handles a missing port", () => {
    expect(describeDatabaseUrl("postgresql://db.example.com/app")).toBe(
      "db.example.com/app",
    );
  });

  it("says so plainly when nothing is configured", () => {
    expect(describeDatabaseUrl("")).toBe("(not set)");
    expect(describeDatabaseUrl("   ")).toBe("(not set)");
  });

  it("does not echo an unparseable string back into the log", () => {
    // The realistic bad input is a half-pasted connection string, which may
    // still contain the password.
    const described = describeDatabaseUrl("postgres:hunter2@host-without-scheme");
    expect(described).toBe("(unparseable connection string)");
    expect(described).not.toContain("hunter2");
  });

  it("does not leak a password containing an @ or a colon", () => {
    const described = describeDatabaseUrl(
      "postgresql://user:p%40ss%3Aword@host.internal:5432/db",
    );
    expect(described).not.toContain("ss:word");
    expect(described).not.toContain("p@ss");
    expect(described).toBe("user@host.internal:5432/db");
  });
});
