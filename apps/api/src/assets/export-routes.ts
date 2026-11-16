import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromNodeHeaders } from "better-auth/node";
import { ObjectId, type Collection, type Document } from "mongodb";
import { fileTypeFromBuffer } from "file-type";
import {
  apiErrorResponseSchema,
  projectExportFileResponseSchema,
  projectExportPolicy,
  projectExportResponseSchema,
  projectExportsResponseSchema,
  projectExportUploadIntentResponseSchema,
  projectExportUploadRequestSchema,
  projectIdParamsSchema,
  assetIdParamsSchema,
} from "@videogen/contracts";
import type { MongoDatabase } from "@videogen/database";
import type { createAuth } from "../auth.js";
import { config } from "../config.js";
import { ProjectRepository } from "../projects/project-repository.js";
import { copyObject, createReadUrl, createUploadUrl, deleteObject, inspectObject, readObject } from "./r2-storage.js";

const execFileAsync = promisify(execFile);
type ExportAuth = ReturnType<typeof createAuth>;
type ExportStatus = "pending" | "verifying" | "ready" | "deleting";
interface ExportDocument extends Document {
  _id: ObjectId;
  ownerUserId: string;
  projectId: ObjectId;
  status: ExportStatus;
  fileName: string;
  contentType: "video/mp4";
  sizeBytes: number;
  uploadKey: string;
  objectKey: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  intentExpiresAt: Date;
  verificationStartedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
interface ExportQuotaLockDocument extends Document { _id: string; revision: number }

function sendError(reply: any, status: number, code: string, message: string) {
  return reply.status(status).send(apiErrorResponseSchema.parse({ error: { code, message } }));
}

function toResponse(item: ExportDocument) {
  if (!item.width || !item.height || !item.durationSeconds) throw new Error("Ready export has no media metadata.");
  return { id: item._id.toHexString(), fileName: item.fileName, sizeBytes: item.sizeBytes, width: item.width,
    height: item.height, durationSeconds: item.durationSeconds, createdAt: item.createdAt.toISOString() };
}

export async function registerExportRoutes(app: any, auth: ExportAuth, mongo: MongoDatabase, projects: ProjectRepository): Promise<void> {
  const exports: Collection<ExportDocument> = mongo.database().collection("projectExports");
  const quotaLocks: Collection<ExportQuotaLockDocument> = mongo.database().collection("exportQuotaLocks");
  const socialPosts = mongo.database().collection<Document & { ownerUserId: string; projectId: ObjectId; exportId: ObjectId; status: string }>("social_posts");
  await exports.createIndex({ ownerUserId: 1, projectId: 1, status: 1, createdAt: -1 }, { name: "project_exports_list" });
  await exports.createIndex({ status: 1, intentExpiresAt: 1 }, { name: "project_exports_pending_cleanup" });

  const requireUser = async (request: any, reply: any): Promise<string | undefined> => {
    if (!config.ASSET_UPLOADS_ENABLED) {
      sendError(reply, 503, "EXPORTS_DISABLED", "Project exports are not enabled in this environment.");
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

  const removeObjectsAndRecord = async (item: ExportDocument): Promise<void> => {
    await exports.updateOne({ _id: item._id }, { $set: { status: "deleting", updatedAt: new Date() }, $unset: { verificationStartedAt: "" } });
    await Promise.all([...new Set([item.uploadKey, item.objectKey])].filter(Boolean).map((key) => deleteObject(key)));
    await exports.deleteOne({ _id: item._id, status: "deleting" });
  };

  const cleanupPending = async (): Promise<void> => {
    const now = new Date();
    const staleVerificationBefore = new Date(now.getTime() - 5 * 60_000);
    const candidates = await exports.find({ $or: [
      { status: "pending", intentExpiresAt: { $lte: now } },
      { status: "verifying", verificationStartedAt: { $lte: staleVerificationBefore } },
      { status: "deleting" },
      { status: "ready", uploadKey: { $exists: true } },
    ] }).sort({ updatedAt: 1 }).limit(50).toArray();
    for (const item of candidates) {
      try {
        if (item.status === "ready") {
          await deleteObject(item.uploadKey);
          await exports.updateOne({ _id: item._id, status: "ready", uploadKey: item.uploadKey }, { $unset: { uploadKey: "" } });
        } else await removeObjectsAndRecord(item);
      } catch (error) {
        await exports.updateOne({ _id: item._id, status: { $in: ["pending", "verifying", "deleting"] } }, { $set: { status: "deleting", updatedAt: new Date() }, $unset: { verificationStartedAt: "" } }).catch(() => undefined);
        app.log.warn({ err: error, exportId: item._id.toHexString() }, "Project export cleanup will retry.");
      }
    }
  };
  let cleanupRunning = false;
  const cleanupTimer = setInterval(() => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    void cleanupPending().catch((error) => app.log.warn({ err: error }, "Project export cleanup pass failed.")).finally(() => { cleanupRunning = false; });
  }, 60_000);
  cleanupTimer.unref?.();
  app.addHook("onClose", async () => clearInterval(cleanupTimer));

  app.get("/api/v1/projects/:projectId/exports", async (request: any, reply: any) => {
    const ownerUserId = await requireUser(request, reply); if (!ownerUserId) return;
    const params = projectIdParamsSchema.safeParse(request.params);
    if (!params.success) return sendError(reply, 400, "VALIDATION_ERROR", "Project ID is invalid.");
    try {
      const projectId = new ObjectId(params.data.projectId);
      if (!await projects.get(ownerUserId, projectId)) return sendError(reply, 404, "PROJECT_NOT_FOUND", "Project was not found.");
      const rows = await exports.find({ ownerUserId, projectId, status: "ready" }).sort({ createdAt: -1 }).toArray();
      return reply.send(projectExportsResponseSchema.parse({ data: { items: rows.map(toResponse) } }));
    } catch {
      request.log.error("Project export listing failed.");
      return sendError(reply, 503, "EXPORTS_UNAVAILABLE", "Project exports are temporarily unavailable.");
    }
  });

  app.post("/api/v1/projects/:projectId/export-upload-intents", async (request: any, reply: any) => {
    const ownerUserId = await requireUser(request, reply); if (!ownerUserId) return;
    const params = projectIdParamsSchema.safeParse(request.params);
    const input = projectExportUploadRequestSchema.safeParse(request.body);
    if (!params.success || !input.success) return sendError(reply, 400, "VALIDATION_ERROR", "Export upload details are invalid.");
    const projectId = new ObjectId(params.data.projectId);
    const now = new Date();
    const id = new ObjectId();
    const uploadKey = `incoming/exports/${randomUUID()}`;
    const objectKey = `exports/${id.toHexString()}`;
    const intentExpiresAt = new Date(now.getTime() + projectExportPolicy.uploadUrlTtlSeconds * 1000);
    try {
      const project = await projects.get(ownerUserId, projectId);
      if (!project || project.status !== "active") return sendError(reply, 404, "PROJECT_NOT_FOUND", "Active project was not found.");
      const uploadUrl = await createUploadUrl(uploadKey, "video/mp4", input.data.sizeBytes);
      const item: ExportDocument = { _id: id, ownerUserId, projectId, status: "pending", fileName: input.data.fileName,
        contentType: "video/mp4", sizeBytes: input.data.sizeBytes, uploadKey, objectKey, intentExpiresAt, createdAt: now, updatedAt: now };
      try { await quotaLocks.updateOne({ _id: ownerUserId }, { $setOnInsert: { revision: 0 } }, { upsert: true }); }
      catch (error) { if (!(typeof error === "object" && error !== null && "code" in error && error.code === 11000)) throw error; }
      const session = mongo.clientHandle().startSession();
      try {
        await session.withTransaction(async () => {
          await quotaLocks.updateOne({ _id: ownerUserId }, { $inc: { revision: 1 } }, { session });
          const count = await exports.countDocuments({ ownerUserId, projectId }, { session });
          const totals = await exports.aggregate<{ bytes: number }>([
            { $match: { ownerUserId } }, { $group: { _id: null, bytes: { $sum: "$sizeBytes" } } },
          ], { session }).toArray();
          if (count >= projectExportPolicy.maxExportsPerProject || (totals[0]?.bytes ?? 0) + item.sizeBytes > projectExportPolicy.maxBytesPerUser) throw new Error("EXPORT_QUOTA_EXCEEDED");
          await exports.insertOne(item, { session });
        });
      } finally { await session.endSession(); }
      return reply.status(201).send(projectExportUploadIntentResponseSchema.parse({ data: { exportId: id.toHexString(), uploadUrl, expiresAt: intentExpiresAt.toISOString() } }));
    } catch (error) {
      if (error instanceof Error && error.message === "EXPORT_QUOTA_EXCEEDED") return sendError(reply, 413, "EXPORT_QUOTA_EXCEEDED", "Project export storage limit has been reached.");
      request.log.error("Project export upload intent creation failed.");
      return sendError(reply, 503, "EXPORTS_UNAVAILABLE", "Project exports are temporarily unavailable.");
    }
  });

  app.post("/api/v1/projects/:projectId/exports/:assetId/complete", async (request: any, reply: any) => {
    const ownerUserId = await requireUser(request, reply); if (!ownerUserId) return;
    const projectParams = projectIdParamsSchema.safeParse({ projectId: request.params?.projectId });
    const exportParams = assetIdParamsSchema.safeParse({ assetId: request.params?.assetId });
    if (!projectParams.success || !exportParams.success) return sendError(reply, 400, "VALIDATION_ERROR", "Export ID is invalid.");
    const projectId = new ObjectId(projectParams.data.projectId);
    const exportId = new ObjectId(exportParams.data.assetId);
    try {
      const item = await exports.findOne({ _id: exportId, ownerUserId, projectId });
      if (!item || item.status === "deleting") return sendError(reply, 404, "EXPORT_NOT_FOUND", "Project export was not found.");
      if (item.status === "ready") return reply.send(projectExportResponseSchema.parse({ data: { export: toResponse(item) } }));
      const claimed = await exports.updateOne({ _id: exportId, ownerUserId, projectId, status: "pending" }, { $set: { status: "verifying", verificationStartedAt: new Date(), updatedAt: new Date() } });
      if (claimed.modifiedCount === 0) return sendError(reply, 409, "EXPORT_STATE_CONFLICT", "Export completion is already in progress. Retry shortly.");
      const head = await inspectObject(item.uploadKey);
      if (!head.ETag || head.ContentLength !== item.sizeBytes || head.ContentType !== "video/mp4") {
        await removeObjectsAndRecord(item);
        return sendError(reply, 400, "EXPORT_UPLOAD_MISMATCH", "Uploaded MP4 size or content type does not match the export request.");
      }
      const bytes = await readObject(item.uploadKey, head.ETag);
      const detected = await fileTypeFromBuffer(bytes);
      if (bytes.byteLength !== item.sizeBytes || detected?.mime !== "video/mp4") {
        await removeObjectsAndRecord(item);
        return sendError(reply, 400, "EXPORT_VALIDATION_ERROR", "Uploaded content is not a valid MP4 file.");
      }
      const directory = await mkdtemp(join(tmpdir(), "videogen-export-"));
      let width = 0; let height = 0; let durationSeconds = 0;
      try {
        const filePath = join(directory, "export.mp4");
        await writeFile(filePath, bytes, { flag: "wx" });
        const { stdout } = await execFileAsync(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", filePath], { timeout: 30_000, maxBuffer: 64 * 1024 });
        const parsed = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; width?: number; height?: number }>; format?: { duration?: string } };
        const video = parsed.streams?.find((stream) => stream.codec_type === "video");
        width = video?.width ?? 0; height = video?.height ?? 0; durationSeconds = Number(parsed.format?.duration);
        const hasAudio = parsed.streams?.some((stream) => stream.codec_type === "audio");
        if (!width || !height || width > projectExportPolicy.maxWidth || height > projectExportPolicy.maxHeight || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > projectExportPolicy.maxDurationSeconds) {
          await removeObjectsAndRecord(item);
          return sendError(reply, 400, "EXPORT_VALIDATION_ERROR", "MP4 dimensions or duration exceed the supported export limits.");
        }
        if (!hasAudio) request.log.info({ exportId: exportId.toHexString() }, "Export has no audio stream.");
      } finally { await rm(directory, { recursive: true, force: true }); }
      await copyObject(item.uploadKey, item.objectKey, "video/mp4", head.ETag);
      const updated = await exports.findOneAndUpdate({ _id: exportId, ownerUserId, projectId, status: "verifying" }, {
        $set: { status: "ready", sizeBytes: head.ContentLength, width, height, durationSeconds, updatedAt: new Date() },
        $unset: { verificationStartedAt: "" },
      }, { returnDocument: "after" });
      if (!updated) return sendError(reply, 409, "EXPORT_STATE_CONFLICT", "Export state changed during completion.");
      await deleteObject(item.uploadKey);
      await exports.updateOne({ _id: exportId, status: "ready", uploadKey: item.uploadKey }, { $unset: { uploadKey: "" } });
      return reply.send(projectExportResponseSchema.parse({ data: { export: toResponse(updated) } }));
    } catch (error) {
      const status = typeof error === "object" && error !== null && "$metadata" in error ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode : undefined;
      if (status === 412 || (error instanceof Error && error.message.includes("changed during verification"))) return sendError(reply, 409, "EXPORT_UPLOAD_CHANGED", "The uploaded export changed during verification. Upload it again.");
      await exports.updateOne({ _id: exportId, ownerUserId, projectId, status: "verifying" }, { $set: { status: "pending", updatedAt: new Date() }, $unset: { verificationStartedAt: "" } }).catch(() => undefined);
      request.log.error({ err: error, exportId: exportId.toHexString() }, "Project export verification failed.");
      return sendError(reply, 503, "EXPORTS_UNAVAILABLE", "Export verification failed. Retry completion.");
    }
  });

  const exportFile = async (request: any, reply: any, disposition: "inline" | "attachment") => {
    const ownerUserId = await requireUser(request, reply); if (!ownerUserId) return;
    const projectParams = projectIdParamsSchema.safeParse({ projectId: request.params?.projectId });
    const exportParams = assetIdParamsSchema.safeParse({ assetId: request.params?.assetId });
    if (!projectParams.success || !exportParams.success) return sendError(reply, 400, "VALIDATION_ERROR", "Export ID is invalid.");
    try {
      const item = await exports.findOne({ _id: new ObjectId(exportParams.data.assetId), ownerUserId, projectId: new ObjectId(projectParams.data.projectId), status: "ready" });
      if (!item) return sendError(reply, 404, "EXPORT_NOT_FOUND", "Project export was not found.");
      const url = await createReadUrl(item.objectKey, { type: disposition, fileName: item.fileName });
      return reply.send(projectExportFileResponseSchema.parse({ data: { url, expiresAt: new Date(Date.now() + projectExportPolicy.readUrlTtlSeconds * 1000).toISOString() } }));
    } catch {
      request.log.error("Project export read URL creation failed.");
      return sendError(reply, 503, "EXPORTS_UNAVAILABLE", "Project export is temporarily unavailable.");
    }
  };
  app.get("/api/v1/projects/:projectId/exports/:assetId/preview", (request: any, reply: any) => exportFile(request, reply, "inline"));
  app.get("/api/v1/projects/:projectId/exports/:assetId/download", (request: any, reply: any) => exportFile(request, reply, "attachment"));

  app.delete("/api/v1/projects/:projectId/exports/:assetId", async (request: any, reply: any) => {
    const ownerUserId = await requireUser(request, reply); if (!ownerUserId) return;
    const projectParams = projectIdParamsSchema.safeParse({ projectId: request.params?.projectId });
    const exportParams = assetIdParamsSchema.safeParse({ assetId: request.params?.assetId });
    if (!projectParams.success || !exportParams.success) return sendError(reply, 400, "VALIDATION_ERROR", "Export ID is invalid.");
    try {
      const item = await exports.findOne({ _id: new ObjectId(exportParams.data.assetId), ownerUserId, projectId: new ObjectId(projectParams.data.projectId) });
      if (!item) return reply.status(204).send();
      await socialPosts.updateMany({ ownerUserId, projectId: item.projectId, exportId: item._id, status: "approved" }, {
        $set: { status: "draft", updatedAt: new Date() }, $inc: { revision: 1 }, $unset: { approvedAt: "", approvalSnapshot: "" },
      });
      await removeObjectsAndRecord(item);
      return reply.status(204).send();
    } catch {
      request.log.error("Project export deletion failed; retry is safe.");
      return sendError(reply, 503, "EXPORT_CLEANUP_PENDING", "Export deletion is still in progress. Retry shortly.");
    }
  });
}
