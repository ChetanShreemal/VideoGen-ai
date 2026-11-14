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

export async function createUploadUrl(key: string, contentType: string): Promise<string> {
  return getSignedUrl(configuredClient(), new PutObjectCommand({ Bucket: r2Bucket, Key: key, ContentType: contentType }), { expiresIn: 600 });
}

export async function createReadUrl(key: string): Promise<string> {
  return getSignedUrl(configuredClient(), new GetObjectCommand({ Bucket: r2Bucket, Key: key }), { expiresIn: 300 });
}

export async function copyObject(source: string, target: string, contentType: string): Promise<void> {
  await configuredClient().send(new CopyObjectCommand({
    Bucket: r2Bucket, Key: target, CopySource: `${r2Bucket}/${encodeURIComponent(source).replaceAll("%2F", "/")}`,
    ContentType: contentType, MetadataDirective: "REPLACE",
  }));
}

export async function readObject(key: string): Promise<Buffer> {
  const result = await configuredClient().send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
  if (!result.Body) throw new Error("R2 object has no body.");
  return Buffer.from(await result.Body.transformToByteArray());
}

export async function inspectObject(key: string) {
  return configuredClient().send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key }));
}

export async function deleteObject(key: string): Promise<void> {
  await configuredClient().send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: key }));
}
