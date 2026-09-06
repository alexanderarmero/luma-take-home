import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";
import type { FetchedObject, ObjectStore, PutInput, StoredObject } from "./store.js";

export interface S3StoreOptions {
  bucket: string;
  region: string;
  /** Set for Railway Buckets, Cloudflare R2, or any S3-compatible host. */
  endpoint?: string;
  /**
   * Path-style addressing (`endpoint/bucket/key`) instead of the standard
   * virtual-hosted style (`bucket.endpoint/key`).
   *
   * Defaults to false, because virtual-hosted is what the S3 API and Railway
   * Buckets both use. Only turn it on for a host that requires it — some
   * older Railway buckets do, and their Credentials tab says so.
   */
  forcePathStyle?: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  /** Injectable so the wiring is testable without a bucket. */
  client?: S3Client;
}

/**
 * S3-compatible object storage.
 *
 * Railway Buckets, Cloudflare R2 and AWS S3 all speak the same API, so the
 * provider stays a provisioning decision rather than a code one. The only
 * thing that genuinely varies is URL style, which is why it is a setting
 * rather than an assumption.
 */
export function createS3ObjectStore(options: S3StoreOptions): ObjectStore {
  const client =
    options.client ??
    new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      ...(options.forcePathStyle ? { forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });

  return {
    async put({
      bytes,
      contentType,
      filename,
      prefix = "images",
    }: PutInput): Promise<StoredObject> {
      const key = `${prefix}/${randomUUID()}.jpg`;

      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          // Set here as well as on our own serving route, so a direct fetch
          // still lands with the meaningful name.
          ContentDisposition: `attachment; filename="${filename}"`,
          Metadata: { filename },
        }),
      );

      return {
        key,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        byteLength: bytes.byteLength,
      };
    },

    async get(key: string): Promise<FetchedObject> {
      const result = await client.send(
        new GetObjectCommand({ Bucket: options.bucket, Key: key }),
      );

      const body = result.Body;
      if (!body) throw new Error(`no object at ${key}`);

      const bytes = Buffer.from(await body.transformToByteArray());
      return {
        bytes,
        contentType: result.ContentType ?? "image/jpeg",
        filename: result.Metadata?.filename ?? "image.jpg",
      };
    },
  };
}
