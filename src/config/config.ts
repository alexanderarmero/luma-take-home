export interface Config {
  /** How many Luma generations may be outstanding at once. */
  maxConcurrentGenerations: number;
  port: number;
  databaseUrl: string;
  /** Where Slack fetches our images from. The deployed service's own URL. */
  publicBaseUrl: string;
  lumaApiKey: string;
  /** Optional: without it, shot ideas go to the image model unchanged. */
  anthropicApiKey?: string;
  storage: {
    bucket: string;
    region: string;
    /** Set for Railway Buckets, Cloudflare R2, or any S3-compatible host. */
    endpoint?: string;
    forcePathStyle?: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
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
  "DATABASE_URL",
  "PUBLIC_BASE_URL",
  "LUMA_AGENTS_API_KEY",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
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
/** Falls back rather than throwing: a typo here must not stop the service. */
function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim());
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

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

  const endpoint = env.S3_ENDPOINT?.trim();

  return {
    port,
    databaseUrl: env.DATABASE_URL!.trim(),
    // Trailing slash removed once here rather than at every use site.
    publicBaseUrl: env.PUBLIC_BASE_URL!.trim().replace(/\/+$/, ""),
    lumaApiKey: env.LUMA_AGENTS_API_KEY!.trim(),
    ...(env.ANTHROPIC_API_KEY?.trim()
      ? { anthropicApiKey: env.ANTHROPIC_API_KEY.trim() }
      : {}),
    storage: {
      bucket: env.S3_BUCKET!.trim(),
      // Railway and R2 both ignore the region while the SDK insists on one;
      // "auto" is the documented value for both, and AWS overrides it.
      region: env.S3_REGION?.trim() || "auto",
      ...(endpoint ? { endpoint } : {}),
      // Off unless asked for: virtual-hosted is the S3 standard and what
      // Railway Buckets use. Some buckets created before Railway's switch
      // still need path-style, and their Credentials tab says so.
      ...(env.S3_FORCE_PATH_STYLE?.trim() === "true"
        ? { forcePathStyle: true }
        : {}),
      accessKeyId: env.S3_ACCESS_KEY_ID!.trim(),
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!.trim(),
    },
    /**
     * How many generations may be outstanding at once.
     *
     * Luma caps concurrent capacity in weight units — ten units, three per
     * image edit — so three at a time. Configurable because that allowance is
     * per account and not ours to hardcode.
     */
    maxConcurrentGenerations: positiveInt(env.LUMA_MAX_CONCURRENT, 3),
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
