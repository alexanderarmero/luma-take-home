import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createHash, randomUUID } from "node:crypto";
import type { FetchedObject, ObjectStore, PutInput, StoredObject } from "./store.js";

export interface S3StoreOptions {
  bucket: string;
  region: string;
  /** Set for Cloudflare R2 or any other S3-compatible host; omit for AWS. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Injectable so the wiring is testable without a bucket. */
  client?: S3Client;
}

/**
 * S3-compatible object storage.
 *
 * Cloudflare R2 speaks the S3 API, so the only difference is an endpoint and
 * forced path-style addressing — which keeps the provider a provisioning
 * decision rather than a code one.
 */
export function createS3ObjectStore(options: S3StoreOptions): ObjectStore {
  const client =
    options.client ??
    new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });

  return {
    async put({ bytes, contentType, filename }: PutInput): Promise<StoredObject> {
      const key = `images/${randomUUID()}.jpg`;

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
