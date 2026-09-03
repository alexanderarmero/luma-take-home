import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const complete = {
  DATABASE_URL: "postgres://localhost/test",
  SLACK_SIGNING_SECRET: "sig",
  SLACK_BOT_TOKEN: "xoxb-token",
  SLACK_REVIEW_CHANNEL_ID: "C123",
  SLACK_APPROVER_USER_ID: "U_ELLIE",
};

describe("loadConfig", () => {
  it("reads the required values from the environment", () => {
    const config = loadConfig(complete);
    expect(config.databaseUrl).toBe("postgres://localhost/test");
    expect(config.slack.signingSecret).toBe("sig");
    expect(config.slack.botToken).toBe("xoxb-token");
    expect(config.slack.reviewChannelId).toBe("C123");
    expect(config.slack.approverUserId).toBe("U_ELLIE");
  });

  it("defaults the port when the platform does not set one", () => {
    expect(loadConfig(complete).port).toBe(3000);
  });

  it("honours the port the hosting platform injects", () => {
    expect(loadConfig({ ...complete, PORT: "8080" }).port).toBe(8080);
  });

  it("reports every missing variable at once, not just the first", () => {
    // Being told about one missing secret at a time turns a single fix into
    // four deploys.
    expect(() => loadConfig({})).toThrowError(
      /DATABASE_URL[\s\S]*SLACK_SIGNING_SECRET[\s\S]*SLACK_BOT_TOKEN[\s\S]*SLACK_REVIEW_CHANNEL_ID[\s\S]*SLACK_APPROVER_USER_ID/,
    );
  });

  it("treats an empty string as missing", () => {
    expect(() => loadConfig({ ...complete, SLACK_BOT_TOKEN: "  " })).toThrowError(
      /SLACK_BOT_TOKEN/,
    );
  });

  it("rejects a non-numeric port rather than silently falling back", () => {
    expect(() => loadConfig({ ...complete, PORT: "http" })).toThrowError(/PORT/);
  });

  it("never puts a secret value into the error message", () => {
    try {
      loadConfig({ SLACK_SIGNING_SECRET: "super-secret-value" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain("super-secret-value");
    }
  });
});
