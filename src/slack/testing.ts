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
