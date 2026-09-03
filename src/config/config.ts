export interface Config {
  port: number;
  slack: {
    signingSecret: string;
    botToken: string;
    reviewChannelId: string;
    /** The only Slack user permitted to approve or discard in v1. */
    approverUserId: string;
  };
}

type Env = Record<string, string | undefined>;

const REQUIRED = [
  "SLACK_SIGNING_SECRET",
  "SLACK_BOT_TOKEN",
  "SLACK_REVIEW_CHANNEL_ID",
  "SLACK_APPROVER_USER_ID",
] as const;

/**
 * Reads configuration from the environment, failing fast and completely.
 *
 * Every missing variable is reported together: discovering them one deploy at
 * a time is the difference between a single fix and four.
 */
export function loadConfig(env: Env): Config {
  const missing = REQUIRED.filter((key) => !env[key]?.trim());

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing
        .map((key) => `  - ${key}`)
        .join("\n")}\nSee .env.example for what each one is.`,
    );
  }

  const port = parsePort(env.PORT);

  return {
    port,
    slack: {
      signingSecret: env.SLACK_SIGNING_SECRET!.trim(),
      botToken: env.SLACK_BOT_TOKEN!.trim(),
      reviewChannelId: env.SLACK_REVIEW_CHANNEL_ID!.trim(),
      approverUserId: env.SLACK_APPROVER_USER_ID!.trim(),
    },
  };
}

function parsePort(raw: string | undefined): number {
  if (!raw?.trim()) return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid port number, got: ${raw}`);
  }
  return port;
}
