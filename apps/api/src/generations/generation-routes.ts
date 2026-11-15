import { createHash } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId, type Collection, type Document } from "mongodb";
import {
  apiErrorResponseSchema,
  createGenerationJobRequestSchema,
  createGenerationJobResponseSchema,
  generationJobEnvelopeSchema,
  generationJobSchema,
  projectIdParamsSchema,
  type StoryboardContent,
} from "@videogen/contracts";
import type { MongoDatabase } from "@videogen/database";
import type { createAuth } from "../auth.js";
import { config } from "../config.js";
import { ProjectRepository } from "../projects/project-repository.js";
import { StoryboardRepository } from "../projects/storyboard-repository.js";

type GenerationAuth = ReturnType<typeof createAuth>;
type JobStatus = "queued" | "running" | "completed" | "failed";
type JobStage = "queued" | "preparing" | "processing_scenes" | "assembling" | "completed" | "failed";
type SceneStatus = "queued" | "running" | "completed" | "failed";

interface GenerationSceneDocument {
  sceneId: string;
  title: string;
  status: SceneStatus;
  progressPercent: number;
}

interface GenerationJobDocument extends Document {
  _id: ObjectId;
  ownerUserId: string;
  projectId: ObjectId;
  storyboardId: ObjectId;
  storyboardVersion: number;
  operation: "generation";
  idempotencyKey: string;
  requestFingerprint: string;
  provider: "mock";
  status: JobStatus;
  stage: JobStage;
  progressPercent: number;
  scenes: GenerationSceneDocument[];
  inputSnapshot: StoryboardContent;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: { code: string; message: string };
}

const mockSceneDelayMs = 500;
const mockStageDelayMs = 350;
const runningJobs = new Set<string>();

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send(apiErrorResponseSchema.parse({ error: { code, message } }));
}

async function requireUser(request: FastifyRequest, reply: FastifyReply, auth: GenerationAuth): Promise<string | undefined> {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      reply.status(401).send(apiErrorResponseSchema.parse({ error: { code: "UNAUTHENTICATED", message: "A valid session is required." } }));
      return undefined;
    }
    return session.user.id;
  } catch {
    sendError(reply, 503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.");
    return undefined;
  }
}

function toResponse(job: GenerationJobDocument) {
  return generationJobSchema.parse({
    id: job._id.toHexString(),
    projectId: job.projectId.toHexString(),
    storyboardId: job.storyboardId.toHexString(),
    storyboardVersion: job.storyboardVersion,
    provider: "mock",
    simulated: true,
    status: job.status,
    stage: job.stage,
    progressPercent: job.progressPercent,
    scenes: job.scenes,
    videoAssetId: null,
    ...(job.error ? { error: job.error } : {}),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    ...(job.startedAt ? { startedAt: job.startedAt.toISOString() } : {}),
    ...(job.completedAt ? { completedAt: job.completedAt.toISOString() } : {}),
  });
}

function delay(duration: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

export async function registerGenerationRoutes(
  app: FastifyInstance,
  auth: GenerationAuth,
  mongo: MongoDatabase,
  projects: ProjectRepository,
  storyboards: StoryboardRepository,
): Promise<void> {
  const jobs: Collection<GenerationJobDocument> = mongo.database().collection("generation_jobs");
  let indexes: Promise<void> | undefined;
  let recovery: Promise<void> | undefined;

  const ensureIndexes = async (): Promise<void> => {
    if (!indexes) indexes = Promise.all([
      jobs.createIndex({ ownerUserId: 1, operation: 1, idempotencyKey: 1 }, { unique: true, name: "uniq_generation_idempotency" }),
      jobs.createIndex({ ownerUserId: 1, createdAt: -1 }, { name: "generation_jobs_owner_created" }),
      jobs.createIndex({ projectId: 1, status: 1, createdAt: -1 }, { name: "generation_jobs_project_status" }),
    ]).then(() => undefined).catch((error: unknown) => { indexes = undefined; throw error; });
    return indexes;
  };

  const runMockJob = async (jobId: ObjectId): Promise<void> => {
    try {
      const now = new Date();
      const claimed = await jobs.findOneAndUpdate(
        { _id: jobId, provider: "mock", status: "queued" },
        { $set: { status: "running", stage: "preparing", progressPercent: 3, startedAt: now, updatedAt: now } },
        { returnDocument: "after" },
      );
      if (!claimed) return;

      await delay(mockStageDelayMs);
      await jobs.updateOne({ _id: jobId, status: "running" }, { $set: { stage: "processing_scenes", updatedAt: new Date() } });
      const total = claimed.scenes.length;
      for (let index = 0; index < total; index += 1) {
        const current = claimed.scenes.map((scene, sceneIndex) => ({
          ...scene,
          status: sceneIndex < index ? "completed" as const : sceneIndex === index ? "running" as const : "queued" as const,
          progressPercent: sceneIndex < index ? 100 : sceneIndex === index ? 0 : 0,
        }));
        const progress = 5 + Math.floor((index / total) * 85);
        await jobs.updateOne({ _id: jobId, status: "running" }, { $set: { scenes: current, progressPercent: progress, stage: "processing_scenes", updatedAt: new Date() } });
        await delay(mockSceneDelayMs);
        current[index] = { ...current[index]!, status: "completed", progressPercent: 100 };
        await jobs.updateOne({ _id: jobId, status: "running" }, { $set: {
          scenes: current,
          progressPercent: 5 + Math.floor(((index + 1) / total) * 85),
          updatedAt: new Date(),
        } });
      }
      await jobs.updateOne({ _id: jobId, status: "running" }, { $set: { stage: "assembling", progressPercent: 95, updatedAt: new Date() } });
      await delay(mockStageDelayMs);
      await jobs.updateOne({ _id: jobId, status: "running" }, { $set: {
        status: "completed", stage: "completed", progressPercent: 100,
        completedAt: new Date(), updatedAt: new Date(),
      } });
    } catch {
      await jobs.updateOne({ _id: jobId, status: { $in: ["queued", "running"] } }, { $set: {
        status: "failed", stage: "failed", updatedAt: new Date(),
        error: { code: "MOCK_GENERATION_FAILED", message: "The generation simulation could not be completed. Try again." },
      } }).catch(() => undefined);
      app.log.warn({ jobId: jobId.toHexString() }, "Mock generation job failed.");
    }
  };

  const enqueue = (jobId: ObjectId): void => {
    const key = jobId.toHexString();
    if (runningJobs.has(key)) return;
    runningJobs.add(key);
    void runMockJob(jobId).finally(() => runningJobs.delete(key));
  };

  const initializeJobs = async (): Promise<void> => {
    await ensureIndexes();
    if (config.NODE_ENV === "production") return;
    if (!recovery) recovery = (async () => {
      const interrupted = await jobs.find({ provider: "mock", status: "running" }).toArray();
      for (const job of interrupted) {
        const scenes = job.scenes.map((scene) => ({ ...scene, status: "queued" as const, progressPercent: 0 }));
        await jobs.updateOne({ _id: job._id, status: "running" }, { $set: {
          status: "queued", stage: "queued", progressPercent: 0, scenes, updatedAt: new Date(),
        }, $unset: { startedAt: "" } });
      }
      const pending = await jobs.find({ provider: "mock", status: "queued" }).project({ _id: 1 }).toArray();
      for (const job of pending) enqueue(job._id);
    })().catch((error: unknown) => { recovery = undefined; throw error; });
    await recovery;
  };

  const responseFor = (reply: FastifyReply, job: GenerationJobDocument) => reply.status(202).send(
    createGenerationJobResponseSchema.parse({ data: {
      jobId: job._id.toHexString(),
      status: job.status,
      statusUrl: `/api/v1/jobs/${job._id.toHexString()}`,
      simulated: true,
    } }),
  );

  app.post("/api/v1/projects/:projectId/generations", async (request, reply) => {
    const ownerUserId = await requireUser(request, reply, auth);
    if (!ownerUserId) return;
    const params = projectIdParamsSchema.safeParse(request.params);
    const input = createGenerationJobRequestSchema.safeParse(request.body);
    const keyValue = request.headers["idempotency-key"];
    const idempotencyKey = typeof keyValue === "string" && /^[\x21-\x7E]{1,128}$/.test(keyValue) ? keyValue : undefined;
    if (!params.success || !input.success || !idempotencyKey) {
      return sendError(reply, 400, "VALIDATION_ERROR", "A valid project, approved storyboard, and Idempotency-Key header are required.");
    }

    const projectId = new ObjectId(params.data.projectId);
    const storyboardId = new ObjectId(input.data.storyboardId);
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ projectId: projectId.toHexString(), storyboardId: storyboardId.toHexString() })).digest("hex");
    try {
      await initializeJobs();
      if (config.NODE_ENV === "production") return sendError(reply, 503, "GENERATION_PROVIDER_UNAVAILABLE", "Video generation is not configured in this environment.");

      const existing = await jobs.findOne({ ownerUserId, operation: "generation", idempotencyKey });
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) return sendError(reply, 409, "IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used with a different generation request.");
        return responseFor(reply, existing);
      }

      const project = await projects.get(ownerUserId, projectId);
      if (!project) return sendError(reply, 404, "PROJECT_NOT_FOUND", "Project was not found.");
      if (project.status !== "active") return sendError(reply, 409, "PROJECT_NOT_ACTIVE", "Restore this project before starting generation.");
      const storyboard = await storyboards.getOwnedVersion(ownerUserId, projectId, storyboardId);
      if (!storyboard) return sendError(reply, 404, "STORYBOARD_NOT_FOUND", "Approved storyboard was not found.");
      if (storyboard.status !== "approved") return sendError(reply, 409, "STORYBOARD_NOT_APPROVED", "Approve this storyboard before starting generation.");

      const now = new Date();
      const job: GenerationJobDocument = {
        _id: new ObjectId(), ownerUserId, projectId, storyboardId,
        storyboardVersion: storyboard.version,
        operation: "generation", idempotencyKey, requestFingerprint,
        provider: "mock", status: "queued", stage: "queued", progressPercent: 0,
        scenes: storyboard.content.scenes.map((scene) => ({ sceneId: scene.id, title: scene.title, status: "queued", progressPercent: 0 })),
        inputSnapshot: storyboard.content,
        createdAt: now, updatedAt: now,
      };
      try {
        await jobs.insertOne(job);
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === 11000)) throw error;
        const raced = await jobs.findOne({ ownerUserId, operation: "generation", idempotencyKey });
        if (!raced) throw error;
        if (raced.requestFingerprint !== requestFingerprint) return sendError(reply, 409, "IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used with a different generation request.");
        return responseFor(reply, raced);
      }
      enqueue(job._id);
      return responseFor(reply, job);
    } catch {
      request.log.error("Generation job creation failed.");
      return sendError(reply, 503, "GENERATION_UNAVAILABLE", "A generation job could not be started. Try again.");
    }
  });

  app.get("/api/v1/jobs/:jobId", async (request, reply) => {
    const ownerUserId = await requireUser(request, reply, auth);
    if (!ownerUserId) return;
    const rawJobId = (request.params as { jobId?: string })?.jobId;
    if (!/^[a-f\d]{24}$/i.test(rawJobId ?? "")) return sendError(reply, 400, "VALIDATION_ERROR", "Job ID is invalid.");
    try {
      await initializeJobs();
      const job = await jobs.findOne({ _id: new ObjectId(rawJobId!), ownerUserId });
      if (!job) return sendError(reply, 404, "JOB_NOT_FOUND", "Generation job was not found.");
      return reply.send(generationJobEnvelopeSchema.parse({ data: { job: toResponse(job) } }));
    } catch {
      request.log.error("Generation job retrieval failed.");
      return sendError(reply, 503, "GENERATION_UNAVAILABLE", "Generation status is temporarily unavailable.");
    }
  });
}
