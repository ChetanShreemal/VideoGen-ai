import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId, type Collection, type Document } from "mongodb";
import { fromNodeHeaders } from "better-auth/node";
import {
  apiErrorResponseSchema,
  assetIdParamsSchema,
  narrationAssetPolicy,
  narrationAssetQuerySchema,
  narrationAssetResponseSchema,
  projectIdParamsSchema,
  projectNarrationAssetsResponseSchema,
  narrationVoiceNames,
} from "@videogen/contracts";
import type { MongoDatabase } from "@videogen/database";
import type { createAuth } from "../auth.js";
import { ProjectRepository } from "../projects/project-repository.js";
import { StoryboardRepository } from "../projects/storyboard-repository.js";
import { createReadUrl, deleteObject, r2Bucket, storePrivateObject } from "../assets/r2-storage.js";

type VoiceAssetAuth = ReturnType<typeof createAuth>;
type NarrationAssetStatus = "pending" | "ready" | "deleting";

interface NarrationAssetDocument extends Document {
  _id: ObjectId;
  ownerUserId: string;
  projectId: ObjectId;
  storyboardId: ObjectId;
  storyboardVersion: number;
  voiceName: typeof narrationVoiceNames[number];
  sizeBytes: number;
  objectKey: string;
  status: NarrationAssetStatus;
  cleanupAfter?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface NarrationQuotaLockDocument extends Document {
  _id: string;
  revision: number;
}

class NarrationQuotaExceededError extends Error {}

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send(apiErrorResponseSchema.parse({ error: { code, message } }));
}

async function requireUser(request: FastifyRequest, reply: FastifyReply, auth: VoiceAssetAuth): Promise<string | undefined> {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      sendError(reply, 401, "UNAUTHENTICATED", "A valid session is required.");
      return undefined;
    }
    return session.user.id;
  } catch {
    sendError(reply, 503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.");
    return undefined;
  }
}

function toResponse(asset: NarrationAssetDocument) {
  return {
    id: asset._id.toHexString(),
    storyboardId: asset.storyboardId.toHexString(),
    storyboardVersion: asset.storyboardVersion,
    voiceName: asset.voiceName,
    sizeBytes: asset.sizeBytes,
    createdAt: asset.createdAt.toISOString(),
  };
}

function isWav(bytes: Buffer): boolean {
  if (bytes.length < 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") return false;
  let offset = 12;
  let hasFormat = false;
  let hasData = false;
  while (offset + 8 <= bytes.length) {
    const chunkName = bytes.toString("ascii", offset, offset + 4);
    const chunkLength = bytes.readUInt32LE(offset + 4);
    const chunkEnd = offset + 8 + chunkLength;
    if (chunkEnd > bytes.length) return false;
    if (chunkName === "fmt " && chunkLength >= 16) hasFormat = true;
    if (chunkName === "data" && chunkLength > 0) hasData = true;
    offset = chunkEnd + (chunkLength % 2);
  }
  return hasFormat && hasData;
}

export async function registerNarrationAssetRoutes(
  app: FastifyInstance,
  auth: VoiceAssetAuth,
  mongo: MongoDatabase,
  projects: ProjectRepository,
  storyboards: StoryboardRepository,
): Promise<void> {
  const assets: Collection<NarrationAssetDocument> = mongo.database().collection("narrationAssets");
  const quotaLocks: Collection<NarrationQuotaLockDocument> = mongo.database().collection("narrationAssetQuotaLocks");
  await assets.createIndex({ ownerUserId: 1, projectId: 1, status: 1, createdAt: -1 }, { name: "narration_assets_project_list" });
  await assets.createIndex({ ownerUserId: 1, status: 1, createdAt: 1 }, { name: "narration_assets_user_quota" });
  await assets.createIndex({ status: 1, cleanupAfter: 1 }, { name: "narration_assets_cleanup" });

  app.addContentTypeParser("audio/wav", { parseAs: "buffer", bodyLimit: narrationAssetPolicy.maxBytesPerFile }, (_request, payload, done) => {
    done(null, payload);
  });

  const cleanupExpired = async (): Promise<void> => {
    const now = new Date();
    const expired = await assets.find({
      $or: [
        { status: "deleting" },
        { status: "pending", cleanupAfter: { $lte: now } },
      ],
    }).limit(50).toArray();
    for (const item of expired) {
      try {
        const claim = await assets.updateOne(
          { _id: item._id, status: item.status, ...(item.status === "pending" ? { cleanupAfter: item.cleanupAfter } : {}) },
          { $set: { status: "deleting", updatedAt: now } },
        );
        if (!claim.modifiedCount) continue;
        await deleteObject(item.objectKey);
        await assets.deleteOne({ _id: item._id, status: "deleting" });
      } catch (error) {
        app.log.warn({ err: error, narrationAssetId: item._id.toHexString() }, "Narration audio cleanup will retry.");
      }
    }
  };
  const cleanupTimer = setInterval(() => {
    void cleanupExpired().catch((error) => app.log.warn({ err: error }, "Narration cleanup pass failed."));
  }, 60_000);
  cleanupTimer.unref();
  app.addHook("onClose", async () => clearInterval(cleanupTimer));

  app.get("/api/v1/projects/:projectId/narration-assets", async (request, reply) => {
    const ownerUserId = await requireUser(request, reply, auth);
    if (!ownerUserId) return;
    const params = projectIdParamsSchema.safeParse(request.params);
    if (!params.success) return sendError(reply, 400, "VALIDATION_ERROR", "Project ID is invalid.");
    try {
      const projectId = new ObjectId(params.data.projectId);
      if (!await projects.get(ownerUserId, projectId)) return sendError(reply, 404, "PROJECT_NOT_FOUND", "Project was not found.");
      const items = await assets.find({ ownerUserId, projectId, status: "ready" }).sort({ createdAt: -1 }).toArray();
      return reply.send(projectNarrationAssetsResponseSchema.parse({ data: { items: items.map(toResponse) } }));
    } catch {
      request.log.error("Narration library listing failed.");
      return sendError(reply, 503, "NARRATION_ASSETS_UNAVAILABLE", "Saved narration is temporarily unavailable.");
    }
  });

  app.post("/api/v1/projects/:projectId/storyboards/:storyboardId/narration-assets", {
    bodyLimit: narrationAssetPolicy.maxBytesPerFile,
  }, async (request, reply) => {
    const ownerUserId = await requireUser(request, reply, auth);
    if (!ownerUserId) return;
    const params = request.params as { projectId?: string; storyboardId?: string };
    const projectParams = projectIdParamsSchema.safeParse({ projectId: params.projectId });
    const query = narrationAssetQuerySchema.safeParse(request.query);
    const storyboardId = params.storyboardId;
    const body = Buffer.isBuffer(request.body) ? request.body : undefined;
    if (!projectParams.success || !/^[a-f\d]{24}$/i.test(storyboardId ?? "") || !query.success || !body || body.length === 0 || body.length > narrationAssetPolicy.maxBytesPerFile) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Provide a valid project, saved storyboard, voice and WAV file up to 25 MiB.");
    }
    if (!isWav(body)) return sendError(reply, 400, "INVALID_NARRATION_AUDIO", "The audio must be a complete playable WAV file.");
    if (!r2Bucket) return sendError(reply, 503, "STORAGE_UNAVAILABLE", "Private audio storage is not configured.");

    const projectId = new ObjectId(projectParams.data.projectId);
    try {
      const project = await projects.get(ownerUserId, projectId);
      if (!project || project.status !== "active") return sendError(reply, 404, "PROJECT_NOT_FOUND", "An active owned project was not found.");
      const storyboard = await storyboards.getOwnedVersion(ownerUserId, projectId, new ObjectId(storyboardId));
      if (!storyboard) return sendError(reply, 404, "STORYBOARD_NOT_FOUND", "Saved storyboard was not found.");

      const now = new Date();
      const id = new ObjectId();
      const objectKey = `narrations/${id.toHexString()}.wav`;
      const asset: NarrationAssetDocument = {
        _id: id, ownerUserId, projectId, storyboardId: new ObjectId(storyboardId),
        storyboardVersion: storyboard.version, voiceName: query.data.voiceName,
        sizeBytes: body.length, objectKey, status: "pending",
        cleanupAfter: new Date(now.getTime() + narrationAssetPolicy.pendingCleanupMs), createdAt: now, updatedAt: now,
      };

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
            const usage = await assets.aggregate<{ total: number }>([
              { $match: { ownerUserId } },
              { $group: { _id: null, total: { $sum: "$sizeBytes" } } },
            ], { session }).toArray();
            if (projectCount >= narrationAssetPolicy.maxAssetsPerProject || (usage[0]?.total ?? 0) + body.length > narrationAssetPolicy.maxBytesPerUser) {
              throw new NarrationQuotaExceededError();
            }
            await assets.insertOne(asset, { session });
          });
        } finally {
          await session.endSession();
        }
      } catch (error) {
        if (error instanceof NarrationQuotaExceededError) return sendError(reply, 413, "NARRATION_STORAGE_LIMIT", "This project or account has reached its saved narration storage limit.");
        throw error;
      }

      try {
        await storePrivateObject(objectKey, body, "audio/wav");
        const updated = await assets.updateOne({ _id: id, ownerUserId, status: "pending" }, { $set: { status: "ready", updatedAt: new Date() }, $unset: { cleanupAfter: "" } });
        if (!updated.modifiedCount) throw new Error("Narration save state changed.");
      } catch (error) {
        await assets.updateOne({ _id: id, ownerUserId, status: "pending" }, { $set: { status: "deleting", updatedAt: new Date() } }).catch(() => undefined);
        await deleteObject(objectKey).then(() => assets.deleteOne({ _id: id, status: "deleting" })).catch(() => undefined);
        throw error;
      }
      return reply.status(201).send(narrationAssetResponseSchema.parse({ data: { asset: toResponse({ ...asset, status: "ready" }) } }));
    } catch {
      request.log.error("Narration audio could not be saved to private storage.");
      return sendError(reply, 503, "NARRATION_SAVE_UNAVAILABLE", "Narration could not be saved. Try again shortly.");
    }
  });

  app.get("/api/v1/projects/:projectId/narration-assets/:assetId/preview", async (request, reply) => {
    const ownerUserId = await requireUser(request, reply, auth);
    if (!ownerUserId) return;
    const projectParams = projectIdParamsSchema.safeParse({ projectId: (request.params as { projectId?: string }).projectId });
    const assetParams = assetIdParamsSchema.safeParse({ assetId: (request.params as { assetId?: string }).assetId });
    if (!projectParams.success || !assetParams.success) return sendError(reply, 400, "VALIDATION_ERROR", "Project or narration ID is invalid.");
    try {
      const asset = await assets.findOne({ _id: new ObjectId(assetParams.data.assetId), projectId: new ObjectId(projectParams.data.projectId), ownerUserId, status: "ready" });
      if (!asset) return sendError(reply, 404, "NARRATION_ASSET_NOT_FOUND", "Saved narration was not found.");
      const url = await createReadUrl(asset.objectKey);
      return reply.send({ data: { url, expiresAt: new Date(Date.now() + narrationAssetPolicy.readUrlTtlSeconds * 1000).toISOString() } });
    } catch {
      request.log.error("Narration preview URL could not be created.");
      return sendError(reply, 503, "NARRATION_ASSETS_UNAVAILABLE", "Saved narration is temporarily unavailable.");
    }
  });

  app.delete("/api/v1/projects/:projectId/narration-assets/:assetId", async (request, reply) => {
    const ownerUserId = await requireUser(request, reply, auth);
    if (!ownerUserId) return;
    const projectParams = projectIdParamsSchema.safeParse({ projectId: (request.params as { projectId?: string }).projectId });
    const assetParams = assetIdParamsSchema.safeParse({ assetId: (request.params as { assetId?: string }).assetId });
    if (!projectParams.success || !assetParams.success) return sendError(reply, 400, "VALIDATION_ERROR", "Project or narration ID is invalid.");
    try {
      const filter = { _id: new ObjectId(assetParams.data.assetId), projectId: new ObjectId(projectParams.data.projectId), ownerUserId };
      const asset = await assets.findOne(filter);
      if (!asset) return reply.status(204).send();
      await assets.updateOne(filter, { $set: { status: "deleting", updatedAt: new Date() } });
      await deleteObject(asset.objectKey);
      await assets.deleteOne({ ...filter, status: "deleting" });
      return reply.status(204).send();
    } catch {
      request.log.warn("Narration deletion is queued for retry by the cleanup worker.");
      return sendError(reply, 503, "NARRATION_DELETE_PENDING", "Narration could not be fully deleted yet. Retry shortly; cleanup will continue automatically.");
    }
  });
}
