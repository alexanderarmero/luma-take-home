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

export interface UploadImageInput {
  channel: string;
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
  uploadImage(input: UploadImageInput): Promise<{ fileId: string }>;
  openView(input: { triggerId: string; view: Record<string, unknown> }): Promise<void>;
  /** Fetches a file Slack is hosting privately. Returns its text. */
  downloadFile(urlPrivate: string): Promise<string>;
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
    throw new Error(`Slack ${method} failed: ${String(body.error ?? "unknown")}`);
  }
  return body;
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
    async uploadImage({ channel, filename, title, bytes, blocks, threadTs }) {
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
        channel_id: channel,
      });
      if (blocks) form.set("blocks", JSON.stringify(blocks));
      if (threadTs) form.set("thread_ts", threadTs);

      await callForm("files.completeUploadExternal", form);
      return { fileId };
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
