import { createHash, randomUUID } from "node:crypto";
import type { FetchedObject, ObjectStore, PutInput, StoredObject } from "./store.js";

export interface MemoryStore extends ObjectStore {
  objects: Map<string, FetchedObject>;
  reset(): void;
}

/** In-memory store for tests. Same contract, no network. */
export function createMemoryStore(): MemoryStore {
  const objects = new Map<string, FetchedObject>();

  return {
    objects,
    async put({ bytes, contentType, filename }: PutInput): Promise<StoredObject> {
      const key = `images/${randomUUID()}.jpg`;
      objects.set(key, { bytes, contentType, filename });
      return {
        key,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
      };
    },
    async get(key: string): Promise<FetchedObject> {
      const found = objects.get(key);
      if (!found) throw new Error(`no object at ${key}`);
      return found;
    },
    reset() {
      objects.clear();
    },
  };
}
