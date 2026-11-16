import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2Config } from "../config.js";

const client = r2Config ? new S3Client({
  region: r2Config.region,
  endpoint: r2Config.endpoint,
  forcePathStyle: true,
  credentials: { accessKeyId: r2Config.accessKeyId, secretAccessKey: r2Config.secretAccessKey },
}) : undefined;

export const r2Bucket = r2Config?.bucketName;

function configuredClient(): S3Client {
  if (!client || !r2Bucket) throw new Error("Cloudflare R2 is not configured.");
  return client;
}

export async function createUploadUrl(key: string, contentType: string, contentLength: number): Promise<string> {
  return getSignedUrl(configuredClient(), new PutObjectCommand({ Bucket: r2Bucket, Key: key, ContentType: contentType, ContentLength: contentLength }), { expiresIn: 600 });
}

export async function createReadUrl(key: string, disposition?: { type: "inline" | "attachment"; fileName: string }): Promise<string> {
  const responseContentDisposition = disposition
    ? `${disposition.type}; filename="${disposition.fileName.replace(/["\\\r\n]/g, "_")}"`
    : undefined;
  return getSignedUrl(configuredClient(), new GetObjectCommand({ Bucket: r2Bucket, Key: key, ResponseContentDisposition: responseContentDisposition }), { expiresIn: 300 });
}

export async function storePrivateObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await configuredClient().send(new PutObjectCommand({ Bucket: r2Bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function copyObject(source: string, target: string, contentType: string, sourceETag: string): Promise<void> {
  await configuredClient().send(new CopyObjectCommand({
    Bucket: r2Bucket, Key: target, CopySource: `${r2Bucket}/${encodeURIComponent(source).replaceAll("%2F", "/")}`,
    CopySourceIfMatch: sourceETag, ContentType: contentType, MetadataDirective: "REPLACE",
  }));
}

export async function readObject(key: string, expectedETag: string): Promise<Buffer> {
  const result = await configuredClient().send(new GetObjectCommand({ Bucket: r2Bucket, Key: key, IfMatch: expectedETag }));
  if (!result.Body) throw new Error("R2 object has no body.");
  if (result.ETag !== expectedETag) throw new Error("R2 object changed during verification.");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function inspectObject(key: string) {
  return configuredClient().send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }));
}

export async function deleteObject(key: string): Promise<void> {
  await configuredClient().send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: key }));
}
