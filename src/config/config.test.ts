import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const complete = {
  DATABASE_URL: "postgres://localhost/test",
  PUBLIC_BASE_URL: "https://shots.up.railway.app",
  LUMA_AGENTS_API_KEY: "luma-api-x",
  S3_BUCKET: "styled-shots",
  S3_ACCESS_KEY_ID: "ak",
  S3_SECRET_ACCESS_KEY: "sk",
  SLACK_SIGNING_SECRET: "sig",
  SLACK_BOT_TOKEN: "xoxb-token",
  SLACK_REVIEW_CHANNEL_ID: "C123",
  SLACK_APPROVER_USER_ID: "U_ELLIE",
};

describe("loadConfig", () => {
  it("reads the required values from the environment", () => {
    const config = loadConfig(complete);
    expect(config.databaseUrl).toBe("postgres://localhost/test");
    expect(config.publicBaseUrl).toBe("https://shots.up.railway.app");
    expect(config.lumaApiKey).toBe("luma-api-x");
    expect(config.storage.bucket).toBe("styled-shots");
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
      /DATABASE_URL[\s\S]*PUBLIC_BASE_URL[\s\S]*LUMA_AGENTS_API_KEY[\s\S]*S3_BUCKET[\s\S]*SLACK_SIGNING_SECRET[\s\S]*SLACK_APPROVER_USER_ID/,
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

  it("defaults the storage region to R2's documented value", () => {
    expect(loadConfig(complete).storage.region).toBe("auto");
  });

  it("omits the endpoint on AWS and sets it for R2", () => {
    expect(loadConfig(complete).storage.endpoint).toBeUndefined();
    const r2 = loadConfig({
      ...complete,
      S3_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
    });
    expect(r2.storage.endpoint).toBe("https://abc123.r2.cloudflarestorage.com");
  });

  it("does not force path-style addressing by default", () => {
    // Railway Buckets use virtual-hosted URLs; defaulting this on would break
    // them at request time rather than at configuration time.
    const r2 = loadConfig({
      ...complete,
      S3_ENDPOINT: "https://storage.railway.app",
    });
    expect(r2.storage.forcePathStyle).toBeUndefined();
  });

  it("allows path-style to be turned on for a host that needs it", () => {
    const cfg = loadConfig({ ...complete, S3_FORCE_PATH_STYLE: "true" });
    expect(cfg.storage.forcePathStyle).toBe(true);
  });

  it("trims a trailing slash off the public base url", () => {
    // Otherwise every image URL gains a double slash, which some proxies
    // normalise and others do not.
    const cfg = loadConfig({
      ...complete,
      PUBLIC_BASE_URL: "https://shots.up.railway.app/",
    });
    expect(cfg.publicBaseUrl).toBe("https://shots.up.railway.app");
  });
});
