export interface StoredObject {
  /** Random and unguessable. The meaningful name is served, not keyed. */
  key: string;
  checksum: string;
  byteLength: number;
}

export interface PutInput {
  bytes: Buffer;
  contentType: string;
  /** Carried as metadata so a direct fetch can still name the file. */
  filename: string;
  /**
   * Which namespace the object belongs to.
   *
   * Two disjoint prefixes rather than one, so the route that serves one-off
   * source photographs can never reach a batch's images and the route that
   * serves batch images can never reach a scratch upload.
   */
  prefix?: "images" | "scratch";
}

export interface FetchedObject {
  bytes: Buffer;
  contentType: string;
  filename: string;
}

/**
 * Somewhere durable to keep image bytes.
 *
 * One canonical object per image: downloaded once, checksummed, stored, never
 * re-encoded. Slack's copy and the export zip are both renderings of this
 * object, which is what makes "the file that ships is the file that was
 * approved" checkable rather than aspirational.
 */
export interface ObjectStore {
  put(input: PutInput): Promise<StoredObject>;
  get(key: string): Promise<FetchedObject>;
}
