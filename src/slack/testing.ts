import type {
  PostMessageInput,
  SlackClient,
  UpdateMessageInput,
  UploadImageInput,
} from "./client.js";

export interface FakeSlack extends SlackClient {
  posts: PostMessageInput[];
  updates: UpdateMessageInput[];
  uploads: UploadImageInput[];
  views: Array<{ triggerId: string; view: Record<string, unknown> }>;
  /** Contents returned by downloadFile, keyed by URL. */
  files: Map<string, string>;
  reset(): void;
}

/**
 * One recording fake for the whole suite.
 *
 * Slack is one of the four collaborators behind the single composition-root
 * seam, so no test reaches the real API. Keeping the fake in one place means a
 * new client method breaks one file rather than every test that constructs an
 * app.
 */
export function createFakeSlack(): FakeSlack {
  const fake: FakeSlack = {
    posts: [],
    updates: [],
    uploads: [],
    views: [],
    files: new Map(),

    postMessage: async (input) => {
      fake.posts.push(input);
      return { ts: `170000000${fake.posts.length}.000100` };
    },
    updateMessage: async (input) => {
      fake.updates.push(input);
    },
    uploadImage: async (input) => {
      fake.uploads.push(input);
      const n = fake.uploads.length;
      return { fileId: `F${n}`, ts: `170000000${n}.000200` };
    },
    openView: async (input) => {
      fake.views.push(input);
    },
    getFileUrl: async (fileId) =>
      `https://files.slack.com/files-pri/T1-${fileId}/image.jpg`,
    downloadFile: async (url) => {
      const content = fake.files.get(url);
      if (content === undefined) {
        throw new Error(`no fake file registered for ${url}`);
      }
      return content;
    },

    reset() {
      fake.posts.length = 0;
      fake.updates.length = 0;
      fake.uploads.length = 0;
      fake.views.length = 0;
      fake.files.clear();
    },
  };

  return fake;
}

/**
 * Filenames of the image blocks in a posted message, in order.
 *
 * Images now ride inside a product's message rather than being uploaded one
 * per post, so tests read them from the blocks.
 */
export function imageFilenames(post: { blocks?: unknown[] }): string[] {
  return ((post.blocks ?? []) as Array<Record<string, unknown>>)
    .filter((b) => b.type === "image")
    .map((b) => String((b.title as { text?: string } | undefined)?.text ?? ""));
}

/** Every image filename across every posted message, in posting order. */
export function allImageFilenames(posts: Array<{ blocks?: unknown[] }>): string[] {
  return posts.flatMap(imageFilenames);
}
