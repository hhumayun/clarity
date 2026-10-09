import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";
import { attachmentError } from "./endpointError";

/**
 * The photo bucket (a private Railway Storage Bucket, S3-compatible), per
 * docs/photos-server.md, section 4. The server never carries photo bytes: it
 * signs links the phone uploads to and downloads from. Backend only.
 *
 * Variables (section 4.1): PHOTOS_BUCKET, PHOTOS_ACCESS_KEY_ID,
 * PHOTOS_SECRET_ACCESS_KEY, PHOTOS_ENDPOINT, PHOTOS_REGION (default "auto"),
 * PHOTOS_PATH_STYLE ("1" for path-style addressing). Without the first four,
 * photos are off: everything else works and photo endpoints answer 503
 * PHOTOS_UNAVAILABLE.
 */

export const UPLOAD_LINK_SECONDS = 15 * 60;
export const VIEW_LINK_SECONDS = 10 * 60;
export const EXPORT_LINK_SECONDS = 60 * 60;

export type Bucket = { s3: S3Client; name: string };
let cached: Bucket | null | undefined;

/** The bucket, or null when its variables aren't set (photos are off). Read once. */
export function bucket(): Bucket | null {
  if (cached !== undefined) return cached;
  const { PHOTOS_BUCKET, PHOTOS_ACCESS_KEY_ID, PHOTOS_SECRET_ACCESS_KEY, PHOTOS_ENDPOINT } = process.env;
  if (!PHOTOS_BUCKET || !PHOTOS_ACCESS_KEY_ID || !PHOTOS_SECRET_ACCESS_KEY || !PHOTOS_ENDPOINT) {
    return (cached = null);
  }
  const s3 = new S3Client({
    region: process.env.PHOTOS_REGION || "auto",
    endpoint: PHOTOS_ENDPOINT,
    forcePathStyle: process.env.PHOTOS_PATH_STYLE === "1",
    credentials: { accessKeyId: PHOTOS_ACCESS_KEY_ID, secretAccessKey: PHOTOS_SECRET_ACCESS_KEY },
    // No checksum of an empty body in presigned PUTs (the SDK adds one by default).
    requestChecksumCalculation: "WHEN_REQUIRED",
    // A hung request must end: the sweep and request handlers wait on these.
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
    maxAttempts: 3,
  });
  return (cached = { s3, name: PHOTOS_BUCKET });
}

/** The bucket, or 503 PHOTOS_UNAVAILABLE. */
export function requireBucket(): Bucket {
  const b = bucket();
  if (!b) throw attachmentError("PHOTOS_UNAVAILABLE");
  return b;
}

/**
 * Runs one bucket call. Any failure is logged by name and HTTP status only
 * (SDK messages can carry the host, bucket and key) and becomes 503
 * PHOTOS_UNAVAILABLE, which clients retry.
 */
export async function s3Call<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
    console.error(`bucket ${what} failed:`, e?.name ?? "Error", e?.$metadata?.httpStatusCode ?? "-");
    throw attachmentError("PHOTOS_UNAVAILABLE");
  }
}

/** u/<userId>/<photoId>/<random>: the user's prefix makes account deletion one listing. */
export const storageKeyFor = (userId: number, photoId: string) =>
  `u/${userId}/${photoId}/${randomBytes(9).toString("base64url")}`;
export const userPrefix = (userId: number) => `u/${userId}/`;

/**
 * A presigned PUT for exactly `bytes` bytes of `contentType`. The client must
 * send exactly the returned headers and a body of exactly `bytes` bytes, and
 * no x-amz-* header of its own.
 */
export async function presignUpload(b: Bucket, key: string, bytes: number, contentType: string) {
  const url = await getSignedUrl(
    b.s3,
    new PutObjectCommand({ Bucket: b.name, Key: key, ContentType: contentType, ContentLength: bytes }),
    // content-length is signed by default; content-type only when asked.
    { expiresIn: UPLOAD_LINK_SECONDS, signableHeaders: new Set(["content-type"]) },
  );
  return {
    url,
    method: "PUT" as const,
    headers: { "Content-Type": contentType } as Record<string, string>,
    expiresAt: new Date(Date.now() + UPLOAD_LINK_SECONDS * 1000),
  };
}

/** A presigned GET for `seconds`; with a filename, the download is offered as that file. */
export async function presignView(b: Bucket, key: string, seconds: number, filename?: string) {
  const safeName = filename?.replace(/["\\\r\n]/g, "");
  const url = await getSignedUrl(
    b.s3,
    new GetObjectCommand({
      Bucket: b.name,
      Key: key,
      ...(safeName ? { ResponseContentDisposition: `attachment; filename="${safeName}"` } : {}),
    }),
    { expiresIn: seconds },
  );
  return { url, expiresAt: new Date(Date.now() + seconds * 1000) };
}

/** Size and type of an uploaded object, or null when it isn't there. Other failures are thrown. */
export async function headObject(
  b: Bucket,
  key: string,
): Promise<{ bytes: number; contentType: string | null } | null> {
  try {
    const head = await b.s3.send(new HeadObjectCommand({ Bucket: b.name, Key: key }));
    return { bytes: Number(head.ContentLength ?? -1), contentType: head.ContentType ?? null };
  } catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey") return null;
    throw error;
  }
}

/** Deletes up to 1,000 keys; returns the keys that failed. A missing key is not a failure. */
export async function deleteObjects(b: Bucket, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return [];
  if (keys.length > 1000) throw new Error("deleteObjects takes at most 1,000 keys");
  const result = await b.s3.send(
    new DeleteObjectsCommand({
      Bucket: b.name,
      Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
    }),
  );
  return (result.Errors ?? [])
    .filter((e) => e.Code !== "NoSuchKey")
    .map((e) => e.Key)
    .filter((key): key is string => typeof key === "string");
}

/** One page of keys under a prefix, with each key's LastModified (now, if the store gives none: never "old"), and the next token. */
export async function listPage(
  b: Bucket,
  prefix: string,
  token?: string,
): Promise<{ objects: { key: string; lastModified: Date }[]; next?: string }> {
  const page = await b.s3.send(
    new ListObjectsV2Command({ Bucket: b.name, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
  );
  const objects = (page.Contents ?? [])
    .filter((o): o is typeof o & { Key: string } => typeof o.Key === "string")
    .map((o) => ({ key: o.Key, lastModified: o.LastModified ?? new Date() }));
  return { objects, next: page.IsTruncated ? page.NextContinuationToken : undefined };
}

/** A small text object (the bucket's owner file), or null when it isn't there. Other failures are thrown. */
export async function getText(b: Bucket, key: string): Promise<string | null> {
  try {
    const out = await b.s3.send(new GetObjectCommand({ Bucket: b.name, Key: key }));
    return (await out.Body?.transformToString("utf-8")) ?? "";
  } catch (error) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
    if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NoSuchKey" || e?.name === "NotFound") return null;
    throw error;
  }
}

/** Writes a small text object (the bucket's owner file). */
export async function putText(b: Bucket, key: string, body: string): Promise<void> {
  await b.s3.send(new PutObjectCommand({ Bucket: b.name, Key: key, Body: body, ContentType: "application/json" }));
}
