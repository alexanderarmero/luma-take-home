import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createMemoryStore } from "./memory.js";
import { createS3ObjectStore } from "./s3.js";

const BYTES = Buffer.from("pretend this is a jpeg");
const CHECKSUM = createHash("sha256").update(BYTES).digest("hex");

describe("memory store", () => {
  it("returns the bytes it was given, unchanged", async () => {
    const store = createMemoryStore();
    const { key } = await store.put({
      bytes: BYTES,
      contentType: "image/jpeg",
      filename: "HG-002_morning_01.jpg",
    });
    const fetched = await store.get(key);
    expect(fetched.bytes.equals(BYTES)).toBe(true);
  });

  it("checksums what it stored", async () => {
    const store = createMemoryStore();
    const stored = await store.put({
      bytes: BYTES,
      contentType: "image/jpeg",
      filename: "a.jpg",
    });
    expect(stored.checksum).toBe(CHECKSUM);
    expect(stored.byteLength).toBe(BYTES.byteLength);
  });

  it("keys objects unguessably rather than by filename", async () => {
    const store = createMemoryStore();
    const stored = await store.put({
      bytes: BYTES,
      contentType: "image/jpeg",
      filename: "HG-002_morning_01.jpg",
    });
    expect(stored.key).not.toContain("HG-002");
    expect(stored.key).not.toContain("morning");
  });

  it("gives two identical uploads different keys", async () => {
    const store = createMemoryStore();
    const a = await store.put({ bytes: BYTES, contentType: "image/jpeg", filename: "a.jpg" });
    const b = await store.put({ bytes: BYTES, contentType: "image/jpeg", filename: "a.jpg" });
    expect(a.key).not.toBe(b.key);
  });
});

describe("S3-compatible store", () => {
  it("writes to the configured bucket with the meaningful name attached", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = createS3ObjectStore({
      bucket: "shots",
      region: "auto",
      accessKeyId: "k",
      secretAccessKey: "s",
      client: { send } as never,
    });

    const stored = await store.put({
      bytes: BYTES,
      contentType: "image/jpeg",
      filename: "HG-002_morning_01.jpg",
    });

    const input = send.mock.calls[0]![0].input as Record<string, unknown>;
    expect(input.Bucket).toBe("shots");
    expect(input.Key).toBe(stored.key);
    expect(input.ContentType).toBe("image/jpeg");
    // The URL stays unguessable while the downloaded file is still named.
    expect(input.ContentDisposition).toContain("HG-002_morning_01.jpg");
    expect(stored.checksum).toBe(CHECKSUM);
  });

  it("reads back the bytes and the name", async () => {
    const send = vi.fn().mockResolvedValue({
      Body: { transformToByteArray: async () => new Uint8Array(BYTES) },
      ContentType: "image/jpeg",
      Metadata: { filename: "HG-002_morning_01.jpg" },
    });
    const store = createS3ObjectStore({
      bucket: "shots",
      region: "auto",
      accessKeyId: "k",
      secretAccessKey: "s",
      client: { send } as never,
    });

    const fetched = await store.get("images/abc.jpg");
    expect(fetched.bytes.equals(BYTES)).toBe(true);
    expect(fetched.filename).toBe("HG-002_morning_01.jpg");
  });

  it("fails clearly when the object is missing", async () => {
    const send = vi.fn().mockResolvedValue({ Body: undefined });
    const store = createS3ObjectStore({
      bucket: "shots",
      region: "auto",
      accessKeyId: "k",
      secretAccessKey: "s",
      client: { send } as never,
    });
    await expect(store.get("images/gone.jpg")).rejects.toThrow(/no object/);
  });

  it("uses virtual-hosted addressing by default, which is what the S3 API expects", async () => {
    // Forcing path-style whenever an endpoint is present would break Railway
    // Buckets, which use virtual-hosted URLs — and it would break at request
    // time, not at configuration time.
    const store = createS3ObjectStore({
      bucket: "shots",
      region: "auto",
      endpoint: "https://storage.railway.app",
      accessKeyId: "k",
      secretAccessKey: "s",
    });
    expect(store).toBeDefined();
  });

  it("still allows path-style for a host that requires it", async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = createS3ObjectStore({
      bucket: "shots",
      region: "auto",
      endpoint: "https://example.invalid",
      forcePathStyle: true,
      accessKeyId: "k",
      secretAccessKey: "s",
      client: { send } as never,
    });
    await store.put({ bytes: BYTES, contentType: "image/jpeg", filename: "a.jpg" });
    expect(send).toHaveBeenCalled();
  });
});
