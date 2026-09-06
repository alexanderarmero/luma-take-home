const SLACK_API = "https://slack.com/api";

export type Block = Record<string, unknown>;

export interface PostMessageInput {
  channel: string;
  text: string;
  blocks?: Block[];
  threadTs?: string;
}

export interface UpdateMessageInput {
  channel: string;
  ts: string;
  text: string;
  blocks?: Block[];
}

export interface UploadFileInput {
  /** Omit to upload without sharing: the file is hosted but stays private. */
  channel?: string;
  filename: string;
  title: string;
  bytes: Buffer;
  blocks?: Block[];
  threadTs?: string;
}

/**
 * Everything the app needs to say to Slack.
 *
 * Substituted wholesale in tests — this is one of the four collaborators
 * behind the single composition-root seam, so no test ever reaches Slack.
 */
export interface SlackClient {
  postMessage(input: PostMessageInput): Promise<{ ts: string }>;
  updateMessage(input: UpdateMessageInput): Promise<void>;
  uploadFile(input: UploadFileInput): Promise<{ fileId: string; ts?: string }>;
  openView(input: { triggerId: string; view: Record<string, unknown> }): Promise<void>;
  /** Redraws an open modal, so a list reflects a change made inside it. */
  /**
   * Redraws an open modal.
   *
   * Addressable by `externalId` as well as `viewId`, because a view pushed in
   * the response to a submission never yields its id to us — we choose the
   * external id up front and use it to find the view again later.
   */
  updateView(input: {
    viewId?: string;
    externalId?: string;
    view: Record<string, unknown>;
  }): Promise<void>;
  /**
   * Answers an interaction privately, to the person who clicked only.
   *
   * `response_url` is how Slack lets an app reply to a button press without
   * posting into the channel — which matters for telling someone their action
   * was refused without announcing it to everyone.
   */
  respondEphemeral(responseUrl: string, text: string): Promise<void>;
  /**
   * A stable link to a message, so a listing can be tapped rather than
   * scrolled to.
   */
  getPermalink(channel: string, messageTs: string): Promise<string | undefined>;
  /** Fetches a file Slack is hosting privately. Returns its text. */
  downloadFile(urlPrivate: string): Promise<string>;
  /**
   * The same download, as bytes.
   *
   * Separate from `downloadFile` because that one guards against Slack's HTML
   * sign-in page by inspecting the text, and an image is not text.
   */
  downloadFileBytes(
    urlPrivate: string,
  ): Promise<{ bytes: Buffer; contentType: string }>;
  /**
   * The bot's own conversation with one person.
   *
   * Needs the `im:write` scope. Used for answers that belong to the person who
   * asked rather than to the channel.
   */
  openDirectMessage(userId: string): Promise<string>;
  /**
   * Pins a message to the channel. Needs the `pins:write` scope.
   *
   * Used for the one message per batch that people come back to. Unpinned
   * when the batch is handed over — a pin nobody removes is clutter with a
   * longer half-life.
   */
  pinMessage(input: { channel: string; ts: string }): Promise<void>;
  unpinMessage(input: { channel: string; ts: string }): Promise<void>;
  /**
   * The private URL of an uploaded file.
   *
   * `files.completeUploadExternal` returns only `{id, title}`, so anything
   * needing the URL has to ask for it separately.
   */
  getFileUrl(fileId: string): Promise<string | undefined>;
}

export interface SlackClientOptions {
  botToken: string;
  fetch?: typeof fetch;
}

/**
 * Slack reports API errors as HTTP 200 with `ok: false`, so the status code
 * alone would make every failure look like a success.
 */
async function slackJson(
  response: Response,
  method: string,
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new Error(`Slack ${method} failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as Record<string, unknown>;
  if (body.ok !== true) {
    throw new Error(`Slack ${method} failed: ${describeSlackError(body)}`);
  }
  return body;
}

/**
 * Slack's error code alone is often useless.
 *
 * `invalid_blocks` says a message was rejected but not which block or which
 * field — while `response_metadata.messages` says exactly that. Discarding it
 * turns a one-line fix into guesswork, which is what happened here.
 */
function describeSlackError(body: Record<string, unknown>): string {
  const code = String(body.error ?? "unknown");

  const details = [
    ...((body.errors as string[] | undefined) ?? []),
    ...(((body.response_metadata as { messages?: string[] } | undefined)?.messages) ?? []),
  ];

  return details.length === 0 ? code : `${code} — ${details.join("; ")}`;
}

export function createSlackClient(options: SlackClientOptions): SlackClient {
  const doFetch = options.fetch ?? fetch;
  const authHeader = { Authorization: `Bearer ${options.botToken}` };

  const callJson = async (method: string, payload: unknown) => {
    const response = await doFetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    return slackJson(response, method);
  };

  const callForm = async (method: string, form: URLSearchParams) => {
    const response = await doFetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    return slackJson(response, method);
  };

  return {
    async postMessage({ channel, text, blocks, threadTs }) {
      const body = await callJson("chat.postMessage", {
        channel,
        text,
        ...(blocks ? { blocks } : {}),
        ...(threadTs ? { thread_ts: threadTs } : {}),
      });
      return { ts: String(body.ts) };
    },

    async updateMessage({ channel, ts, text, blocks }) {
      await callJson("chat.update", {
        channel,
        ts,
        text,
        ...(blocks ? { blocks } : {}),
      });
    },

    /**
     * Three calls: reserve an upload URL, PUT the bytes, then share the file.
     *
     * `blocks` goes on the completion call and `initial_comment` is never sent
     * — Slack ignores blocks outright when a comment is present, which would
     * silently drop the buttons the message exists to carry.
     */
    async uploadFile({ channel, filename, title, bytes, blocks, threadTs }) {
      const reserved = await callForm(
        "files.getUploadURLExternal",
        new URLSearchParams({
          filename,
          length: String(bytes.byteLength),
        }),
      );

      const uploadUrl = String(reserved.upload_url);
      const fileId = String(reserved.file_id);

      const upload = await doFetch(uploadUrl, {
        method: "POST",
        body: new Uint8Array(bytes),
      });
      if (!upload.ok) {
        throw new Error(`Slack file upload failed: HTTP ${upload.status}`);
      }

      const form = new URLSearchParams({
        files: JSON.stringify([{ id: fileId, title }]),
      });
      // Without a channel the file is hosted but not shared anywhere, which is
      // what an image block referencing it by id needs.
      if (channel) form.set("channel_id", channel);
      if (blocks) form.set("blocks", JSON.stringify(blocks));
      if (threadTs) form.set("thread_ts", threadTs);

      const completed = await callForm("files.completeUploadExternal", form);

      // The share timestamp is what lets the message be rewritten in place
      // once a decision is made. Slack nests it under the file's shares, and
      // the shape varies by channel visibility, so it is read defensively —
      // a missing ts is recoverable, a crash here is not.
      const ts = channel ? extractShareTs(completed, channel) : undefined;
      return ts === undefined ? { fileId } : { fileId, ts };
    },

    async updateView({ viewId, externalId, view }) {
      await callJson("views.update", {
        ...(viewId ? { view_id: viewId } : {}),
        ...(externalId ? { external_id: externalId } : {}),
        view,
      });
    },

    async getPermalink(channel, messageTs) {
      const body = await callForm(
        "chat.getPermalink",
        new URLSearchParams({ channel, message_ts: messageTs }),
      );
      return (body.permalink as string | undefined) ?? undefined;
    },

    async respondEphemeral(responseUrl, text) {
      // response_url is a plain webhook, not a Slack API method: it answers
      // with a bare "ok" body rather than the usual {ok: true} envelope.
      const response = await doFetch(responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_type: "ephemeral", text }),
      });
      if (!response.ok) {
        throw new Error(`Slack response_url failed: HTTP ${response.status}`);
      }
    },

    async getFileUrl(fileId) {
      const body = await callForm(
        "files.info",
        new URLSearchParams({ file: fileId }),
      );
      const file = body.file as Record<string, unknown> | undefined;
      return (file?.url_private as string | undefined) ?? undefined;
    },

    async openView({ triggerId, view }) {
      await callJson("views.open", { trigger_id: triggerId, view });
    },

    /**
     * Files uploaded through a modal are private to the workspace, so the
     * request must carry the bot token. Without it Slack answers 200 with an
     * HTML sign-in page rather than an error — which would surface much later
     * as a baffling parse failure naming HTML as the CSV header.
     */
    async downloadFileBytes(urlPrivate) {
      const response = await doFetch(urlPrivate, { headers: authHeader });
      if (!response.ok) {
        throw new Error(`Slack file download failed: HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        // Slack answers an unauthorised download with its sign-in page and a
        // 200, so the status alone would make a lost scope look like success.
        throw new Error(
          "Slack returned its sign-in page instead of the file — the bot is " +
            "probably missing the files:read scope.",
        );
      }

      return {
        bytes: Buffer.from(await response.arrayBuffer()),
        contentType: contentType || "image/jpeg",
      };
    },

    async pinMessage({ channel, ts }) {
      await callJson("pins.add", { channel, timestamp: ts });
    },

    async unpinMessage({ channel, ts }) {
      await callJson("pins.remove", { channel, timestamp: ts });
    },

    async openDirectMessage(userId) {
      const body = await callJson("conversations.open", { users: userId });
      const channel = body.channel as { id?: string } | undefined;
      if (!channel?.id) throw new Error("Slack did not return a DM channel");
      return channel.id;
    },

    async downloadFile(urlPrivate) {
      const response = await doFetch(urlPrivate, { headers: authHeader });
      if (!response.ok) {
        throw new Error(`Slack file download failed: HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") ?? "";
      const text = await response.text();

      if (contentType.includes("text/html") || /^\s*<(!doctype|html)/i.test(text)) {
        throw new Error(
          "The file could not be downloaded from Slack — got a sign-in page " +
            "instead of the file. The bot token may be missing the files:read scope.",
        );
      }

      return text;
    },
  };
}

function extractShareTs(
  body: Record<string, unknown>,
  channel: string,
): string | undefined {
  const files = body.files as Array<Record<string, unknown>> | undefined;
  const shares = files?.[0]?.shares as
    | Record<string, Record<string, Array<{ ts?: string }>>>
    | undefined;
  if (!shares) return undefined;

  for (const visibility of Object.values(shares)) {
    const entry = visibility?.[channel]?.[0]?.ts;
    if (entry) return entry;
  }
  return undefined;
}
