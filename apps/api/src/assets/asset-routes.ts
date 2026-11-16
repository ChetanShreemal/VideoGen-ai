import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromNodeHeaders } from "better-auth/node";
import { ObjectId, type Collection, type Document } from "mongodb";
import sharp from "sharp";
import { fileTypeFromBuffer } from "file-type";
import {
  apiErrorResponseSchema, assetCompletionResponseSchema, assetIdParamsSchema,
  assetPreviewResponseSchema, assetUploadIntentResponseSchema, assetUploadRequestSchema,
  assetUploadPolicy, projectAssetsResponseSchema, projectIdParamsSchema,
} from "@videogen/contracts";
import type { createAuth } from "../auth.js";
import type { MongoDatabase } from "@videogen/database";
import { ProjectRepository } from "../projects/project-repository.js";
import { config } from "../config.js";
import { copyObject, createReadUrl, createUploadUrl, deleteObject, inspectObject, readObject } from "./r2-storage.js";

const execFileAsync = promisify(execFile);
type AssetAuth = ReturnType<typeof createAuth>;
type AssetStatus = "pending" | "verifying" | "ready" | "deleting";
interface AssetDocument extends Document {
  _id: ObjectId; ownerUserId: string; projectId: ObjectId; status: AssetStatus;
  fileName: string; contentType: string; sizeBytes: number; uploadKey?: string; objectKey: string;
  media?: { type: "image"; width: number; height: number } | { type: "video"; width: number; height: number; durationSeconds: number; videoCodec: string };
  intentExpiresAt?: Date; verificationStartedAt?: Date; createdAt: Date; updatedAt: Date;
}
interface AssetQuotaLockDocument extends Document {
  _id: string;
  revision: number;
}

class AssetQuotaExceededError extends Error {
  constructor() {
    super("The project or account reference media limit has been reached.");
    this.name = "AssetQuotaExceededError";
  }
}

const cleanupIntervalMs = 60_000;
const verificationLeaseMs = 5 * 60_000;
const cleanupBatchSize = 50;

function sendError(reply: any, status: number, code: string, message: string) {
  return reply.status(status).send(apiErrorResponseSchema.parse({ error: { code, message } }));
}

function toResponse(asset: AssetDocument) {
  if (!asset.media) throw new Error("Ready asset has no media metadata.");
  return { id: asset._id.toHexString(), fileName: asset.fileName, contentType: asset.contentType,
    sizeBytes: asset.sizeBytes, media: asset.media, createdAt: asset.createdAt.toISOString() };
}

async function inspectMedia(asset: AssetDocument, bytes: Buffer) {
  const detected = await fileTypeFromBuffer(bytes);
  const accepted = asset.contentType.startsWith("image/")
    ? assetUploadPolicy.imageMimeTypes
    : assetUploadPolicy.videoMimeTypes;
  if (!detected || !accepted.includes(detected.mime as never) || detected.mime !== asset.contentType) {
    throw new Error("Uploaded content does not match its declared media type.");
  }
  if (asset.contentType.startsWith("image/")) {
    const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).metadata();
    if (!metadata.width || !metadata.height || metadata.width > assetUploadPolicy.maxVideoWidth || metadata.height > assetUploadPolicy.maxVideoHeight) {
      throw new Error("Image dimensions exceed the supported limits.");
    }
    return { type: "image" as const, width: metadata.width, height: metadata.height };
  }

  const directory = await mkdtemp(join(tmpdir(), "videogen-asset-"));
  const filePath = join(directory, "upload.bin");
  try {
    await writeFile(filePath, bytes, { flag: "wx" });
    const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", filePath], { timeout: 15_000, maxBuffer: 64 * 1024 });
    const parsed = JSON.parse(stdout) as { streams?: Array<{ codec_name?: string; width?: number; height?: number }>; format?: { duration?: string } };
    const stream = parsed.streams?.[0];
    const width = stream?.width ?? 0;
    const height = stream?.height ?? 0;
    const durationSeconds = Number(parsed.format?.duration);
    if (!stream?.codec_name || !width || !height || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > assetUploadPolicy.maxVideoDurationSeconds || width > assetUploadPolicy.maxVideoWidth || height > assetUploadPolicy.maxVideoHeight) {
      throw new Error("Video metadata exceeds the supported limits.");
    }
    return { type: "video" as const, width, height, durationSeconds, videoCodec: stream.codec_name };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function registerAssetRoutes(app: any, auth: AssetAuth, mongo: MongoDatabase, projects: ProjectRepository): Promise<void> {
  const assets: Collection<AssetDocument> = mongo.database().collection("projectAssets");
  const quotaLocks: Collection<AssetQuotaLockDocument> = mongo.database().collection("assetQuotaLocks");
  let indexes: Promise<void> | undefined;
  const ensureIndexes = async (): Promise<void> => {
    if (!indexes) indexes = Promise.all([
      assets.createIndex({ ownerUserId: 1, projectId: 1, status: 1, createdAt: -1 }, { name: "project_assets_owner_status" }),
      assets.createIndex({ ownerUserId: 1, createdAt: 1 }, { name: "user_assets_quota" }),
      assets.createIndex({ status: 1, intentExpiresAt: 1 }, { name: "pending_asset_expiry" }),
      assets.createIndex({ status: 1, verificationStartedAt: 1 }, { name: "stale_asset_verification" }),
    ]).then(() => undefined).catch((error: unknown) => { indexes = undefined; throw error; });
    return indexes;
  };

  const removeAssetObjects = async (asset: AssetDocument): Promise<void> => {
    await Promise.all([
      ...(asset.uploadKey ? [deleteObject(asset.uploadKey)] : []),
      deleteObject(asset.objectKey),
    ]);
    await assets.deleteOne({ _id: asset._id, status: "deleting" });
  };

  const discardUnverifiedAsset = async (assetId: ObjectId, ownerUserId: string, projectId: ObjectId): Promise<void> => {
    await assets.updateOne(
      { _id: assetId, ownerUserId, projectId, status: { $in: ["pending", "verifying"] } },
      { $set: { status: "deleting", updatedAt: new Date() }, $unset: { verificationStartedAt: "" } },
    );
    const deletingAsset = await assets.findOne({ _id: assetId, ownerUserId, projectId, status: "deleting" });
    if (deletingAsset) await removeAssetObjects(deletingAsset);
  };

  const cleanupExpiredAssets = async (): Promise<void> => {
    await ensureIndexes();
    const now = new Date();
    const staleVerificationBefore = new Date(now.getTime() - verificationLeaseMs);
    const candidates = await assets.find({ $or: [
      { status: "pending", $or: [
        { intentExpiresAt: { $lte: now } },
        { intentExpiresAt: { $exists: false }, createdAt: { $lte: new Date(now.getTime() - assetUploadPolicy.uploadUrlTtlSeconds * 1000) } },
      ] },
      { status: "verifying", verificationStartedAt: { $lte: staleVerificationBefore } },
      { status: "deleting" },
      { status: "ready", uploadKey: { $exists: true } },
    ] }).sort({ updatedAt: 1 }).limit(cleanupBatchSize).toArray();

    for (const candidate of candidates) {
      try {
        if (candidate.status === "ready") {
          if (!candidate.uploadKey) continue;
          await deleteObject(candidate.uploadKey);
          await assets.updateOne({ _id: candidate._id, status: "ready", uploadKey: candidate.uploadKey }, { $unset: { uploadKey: "" } });
          continue;
        }
        if (candidate.status !== "deleting") {
          const staleBefore = candidate.status === "verifying" ? staleVerificationBefore : now;
          const claim = await assets.updateOne(
            { _id: candidate._id, status: candidate.status, ...(candidate.status === "verifying" ? { verificationStartedAt: { $lte: staleBefore } } : {}) },
            { $set: { status: "deleting", updatedAt: now } },
          );
          if (claim.modifiedCount === 0) continue;
        }
        await removeAssetObjects({ ...candidate, status: "deleting" });
      } catch (error) {
        await assets.updateOne({ _id: candidate._id, status: "deleting" }, { $set: { updatedAt: new Date() } }).catch(() => undefined);
        app.log.warn({ err: error, assetId: candidate._id.toHexString() }, "Expired asset cleanup will retry.");
      }
    }
  };

  let cleanupRunning = false;
  const cleanupTimer = setInterval(() => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    void cleanupExpiredAssets()
      .catch((error) => app.log.warn({ err: error }, "Expired asset cleanup pass failed."))
      .finally(() => { cleanupRunning = false; });
  }, cleanupIntervalMs);
  cleanupTimer.unref?.();
  app.addHook("onClose", async () => clearInterval(cleanupTimer));

  const requireUser = async (request: any, reply: any): Promise<string | undefined> => {
    if (!config.ASSET_UPLOADS_ENABLED) {
      sendError(reply, 503, "ASSET_UPLOADS_DISABLED", "Reference uploads are not enabled in this environment.");
      return undefined;
    }
    try {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      if (!session) { sendError(reply, 401, "UNAUTHENTICATED", "A valid session is required."); return undefined; }
      return session.user.id;
    } catch {
      sendError(reply, 503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.");
      return undefined;
    }
  };

  app.get("/api/v1/projects/:projectId/assets", async (request: any, reply: any) => {
    const ownerUserId = await requireUser(request, reply); if (!ownerUserId) return;
    const params = projectIdParamsSchema.safeParse(request.params);
    if (!params.success) return sendError(reply, 400, "VALIDATION_ERROR", "Project ID is invalid.");
    try {
      await ensureIndexes();
      const project = await projects.get(ownerUserId, new ObjectId(params.data.projectId));
      if (!project) return sendError(reply, 404, "PROJECT_NOT_FOUND", "Project was not found.");
      const rows = await assets.find({ ownerUserId, projectId: new ObjectId(params.data.projectId), status: "ready" }).sort({ createdAt: -1 }).toArray();
      return reply.send(projectAssetsResponseSchema.parse({ data: { items: rows.map(toResponse) } }));
    } catch { request.log.error("Asset listing failed."); return sendError(reply, 503, "ASSETS_UNAVAILABLE", "Project assets are temporarily unavailable."); }
  });

  app.post("/api/v1/projects/:projectId/assets/upload-intents", async (request: any, reply: any) => {
    const ownerUserId = await requireUser(request, reply); if (!ownerUserId) return;
    const params = projectIdParamsSchema.safeParse(request.params);
    const input = assetUploadRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return sendError(reply, 400, "VALIDATION_ERROR", "Upload details are invalid.");
    try {
      await ensureIndexes();
      const projectId = new ObjectId(params.data.projectId);
      const project = await projects.get(ownerUserId, projectId);
      if (!project || project.status !== "active") return sendError(reply, 404, "PROJECT_NOT_FOUND", "Active project was not found.");
      const now = new Date();
      const id = new ObjectId();
      const uploadKey = `incoming/${randomUUID()}`;
      const objectKey = `references/${id.toHexString()}`;
      const intentExpiresAt = new Date(now.getTime() + assetUploadPolicy.uploadUrlTtlSeconds * 1000);
      const uploadUrl = await createUploadUrl(uploadKey, input.data.contentType, input.data.sizeBytes);
      const asset: AssetDocument = { _id: id, ownerUserId, projectId, status: "pending", fileName: input.data.fileName,
        contentType: input.data.contentType, sizeBytes: input.data.sizeBytes, uploadKey, objectKey, intentExpiresAt, createdAt: now, updatedAt: now };
      try {
        try {
          await quotaLocks.updateOne({ _id: ownerUserId }, { $setOnInsert: { revision: 0 } }, { upsert: true });
        } catch (error) {
          if (!(typeof error === "object" && error !== null && "code" in error && error.code === 11000)) throw error;
        }
        const session = mongo.clientHandle().startSession();
        try {
          await session.withTransaction(async () => {
            await quotaLocks.updateOne({ _id: ownerUserId }, { $inc: { revision: 1 } }, { session });
            const projectCount = await assets.countDocuments({ ownerUserId, projectId }, { session });
            const userUsage = await assets.aggregate<{ total: number }>(
              [{ $match: { ownerUserId } }, { $group: { _id: null, total: { $sum: "$sizeBytes" } } }],
              { session },
            ).toArray();
            if (projectCount >= assetUploadPolicy.maxAssetsPerProject || (userUsage[0]?.total ?? 0) + input.data.sizeBytes > assetUploadPolicy.maxBytesPerUser) {
              throw new AssetQuotaExceededError();
            }
            await assets.insertOne(asset, { session });
          });
        } finally {
          await session.endSession();
        }
      } catch (error) {
        if (error instanceof AssetQuotaExceededError) {
          return sendError(reply, 413, "ASSET_QUOTA_EXCEEDED", error.message);
        }
        throw error;
      }
      return reply.status(201).send(assetUploadIntentResponseSchema.parse({ data: { assetId: id.toHexString(), uploadUrl, expiresAt: intentExpiresAt.toISOString() } }));
    } catch (error) {
      request.log.error("Asset upload intent creation failed.");
      return sendError(reply, error instanceof Error && error.message.includes("R2") ? 503 : 503, "ASSETS_UNAVAILABLE", "Asset uploads are temporarily unavailable.");
    }
  });

  app.post("/api/v1/projects/:projectId/assets/:assetId/complete", async (request: any, reply: any) => {
    const ownerUserId = await requireUser(request, reply); if (!ownerUserId) return;
    const projectParams = projectIdParamsSchema.safeParse({ projectId: request.params?.projectId });
    const assetParams = assetIdParamsSchema.safeParse({ assetId: request.params?.assetId });
    if (!projectParams.success || !assetParams.success) return sendError(reply, 400, "VALIDATION_ERROR", "Asset ID is invalid.");
    const projectId = new ObjectId(projectParams.data.projectId);
    const assetId = new ObjectId(assetParams.data.assetId);
    let verificationStage = "checking the upload";
    try {
      await ensureIndexes();
      const project = await projects.get(ownerUserId, projectId);
      if (!project) return sendError(reply, 404, "PROJECT_NOT_FOUND", "Project was not found.");
      const asset = await assets.findOne({ _id: assetId, ownerUserId, projectId });
      if (!asset || asset.status === "deleting") return sendError(reply, 404, "ASSET_NOT_FOUND", "Asset was not found.");
      if (asset.status === "ready") return reply.send(assetCompletionResponseSchema.parse({ data: { asset: toResponse(asset) } }));
      const claimed = await assets.updateOne(
        { _id: assetId, ownerUserId, projectId, status: "pending" },
        { $set: { status: "verifying", verificationStartedAt: new Date(), updatedAt: new Date() } },
      );
      if (claimed.modifiedCount === 0) return sendError(reply, 409, "ASSET_STATE_CONFLICT", "Asset completion is already in progress or the asset state changed. Retry shortly.");
      const verifyingAsset = { ...asset, status: "verifying" as const };
      if (!verifyingAsset.uploadKey) {
        await discardUnverifiedAsset(assetId, ownerUserId, projectId);
        return sendError(reply, 404, "ASSET_NOT_FOUND", "Upload object was not found.");
      }
      verificationStage = "reading uploaded-object metadata";
      const head = await inspectObject(verifyingAsset.uploadKey);
      if (!head.ETag) throw new Error("Uploaded object has no ETag.");
      if (head.ContentLength !== asset.sizeBytes || head.ContentType !== asset.contentType) {
        await discardUnverifiedAsset(assetId, ownerUserId, projectId);
        return sendError(reply, 400, "ASSET_UPLOAD_MISMATCH", "Uploaded file size or content type does not match the upload request.");
      }
      verificationStage = "reading uploaded bytes from storage";
      const bytes = await readObject(verifyingAsset.uploadKey, head.ETag);
      if (bytes.byteLength !== asset.sizeBytes) {
        await discardUnverifiedAsset(assetId, ownerUserId, projectId);
        return sendError(reply, 400, "ASSET_UPLOAD_MISMATCH", "Uploaded file size does not match the upload request.");
      }
      verificationStage = "inspecting video metadata";
      const media = await inspectMedia(asset, bytes);
      verificationStage = "promoting the verified file in storage";
      await copyObject(verifyingAsset.uploadKey, asset.objectKey, asset.contentType, head.ETag);
      const now = new Date();
      verificationStage = "saving verified asset metadata";
      await assets.updateOne({ _id: assetId, ownerUserId, projectId, status: "verifying" }, { $set: { status: "ready", sizeBytes: head.ContentLength, media, updatedAt: now }, $unset: { verificationStartedAt: "" } });
      const ready = await assets.findOne({ _id: assetId, ownerUserId, projectId, status: "ready" });
      if (!ready) return sendError(reply, 409, "ASSET_STATE_CONFLICT", "Asset state changed; retry completion.");
      verificationStage = "removing the temporary upload";
      await deleteObject(verifyingAsset.uploadKey);
      await assets.updateOne({ _id: assetId, status: "ready", uploadKey: verifyingAsset.uploadKey }, { $unset: { uploadKey: "" } });
      return reply.send(assetCompletionResponseSchema.parse({ data: { asset: toResponse(ready) } }));
    } catch (error) {
      const statusCode = typeof error === "object" && error !== null && "$metadata" in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
        : undefined;
      if (statusCode === 412 || (error instanceof Error && error.message.includes("changed during verification"))) {
        await discardUnverifiedAsset(assetId, ownerUserId, projectId).catch((cleanupError) => request.log.warn({ err: cleanupError }, "Changed upload cleanup will retry."));
        return sendError(reply, 409, "ASSET_UPLOAD_CHANGED", "The uploaded object changed during verification. Upload it again before completing.");
      }
      if (error instanceof Error && (error.message.includes("does not match") || error.message.includes("dimensions") || error.message.includes("metadata"))) {
        await discardUnverifiedAsset(assetId, ownerUserId, projectId).catch((cleanupError) => request.log.warn({ err: cleanupError }, "Invalid upload cleanup will retry."));
        return sendError(reply, 400, "ASSET_VALIDATION_ERROR", error.message);
      }
      await assets.updateOne({ _id: assetId, ownerUserId, projectId, status: "verifying" }, { $set: { status: "pending", updatedAt: new Date() }, $unset: { verificationStartedAt: "" } }).catch(() => undefined);
      request.log.error({ err: error, assetId: assetId.toHexString(), stage: verificationStage }, "Asset completion failed.");
      return sendError(reply, 503, "ASSETS_UNAVAILABLE", `Asset verification failed while ${verificationStage}. Retry completion.`);
    }
  });

  app.get("/api/v1/projects/:projectId/assets/:assetId/preview", async (request: any, reply: any) => {
    const ownerUserId = await requireUser(request, reply); if (!ownerUserId) return;
    const projectParams = projectIdParamsSchema.safeParse({ projectId: request.params?.projectId });
    const assetParams = assetIdParamsSchema.safeParse({ assetId: request.params?.assetId });
    if (!projectParams.success || !assetParams.success) return sendError(reply, 400, "VALIDATION_ERROR", "Asset ID is invalid.");
    try {
      await ensureIndexes();
      const asset = await assets.findOne({ _id: new ObjectId(assetParams.data.assetId), projectId: new ObjectId(projectParams.data.projectId), ownerUserId, status: "ready" });
      if (!asset) return sendError(reply, 404, "ASSET_NOT_FOUND", "Asset was not found.");
      const url = await createReadUrl(asset.objectKey);
      return reply.send(assetPreviewResponseSchema.parse({ data: { url, expiresAt: new Date(Date.now() + assetUploadPolicy.readUrlTtlSeconds * 1000).toISOString() } }));
    } catch { request.log.error("Asset preview URL creation failed."); return sendError(reply, 503, "ASSETS_UNAVAILABLE", "Asset preview is temporarily unavailable."); }
  });

  app.delete("/api/v1/projects/:projectId/assets/:assetId", async (request: any, reply: any) => {
    const ownerUserId = await requireUser(request, reply); if (!ownerUserId) return;
    const projectParams = projectIdParamsSchema.safeParse({ projectId: request.params?.projectId });
    const assetParams = assetIdParamsSchema.safeParse({ assetId: request.params?.assetId });
    if (!projectParams.success || !assetParams.success) return sendError(reply, 400, "VALIDATION_ERROR", "Asset ID is invalid.");
    const projectId = new ObjectId(projectParams.data.projectId);
    const assetId = new ObjectId(assetParams.data.assetId);
    try {
      await ensureIndexes();
      const asset = await assets.findOne({ _id: assetId, projectId, ownerUserId });
      if (!asset) return reply.status(204).send();
      await assets.updateOne({ _id: assetId, ownerUserId, projectId }, { $set: { status: "deleting", updatedAt: new Date() }, $unset: { verificationStartedAt: "" } });
      const deletingAsset = { ...asset, status: "deleting" as const };
      await removeAssetObjects(deletingAsset);
      return reply.status(204).send();
    } catch { request.log.error("Asset deletion failed; retry is safe."); return sendError(reply, 503, "ASSET_CLEANUP_PENDING", "Asset removal is still in progress. Retry deletion."); }
  });
}
