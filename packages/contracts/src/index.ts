import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("videogen-api"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  status: z.enum(["ready", "not_ready"]),
  service: z.literal("videogen-api"),
  database: z.enum(["connected", "unavailable"]),
});

export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;

export const currentUserResponseSchema = z.object({
  data: z.object({
    user: z.object({
      id: z.string(),
      name: z.string(),
      email: z.email(),
      emailVerified: z.boolean(),
    }),
  }),
});

export type CurrentUserResponse = z.infer<typeof currentUserResponseSchema>;

export const unauthenticatedResponseSchema = z.object({
  error: z.object({
    code: z.literal("UNAUTHENTICATED"),
    message: z.string(),
  }),
});

// Keep the value sets for language, visual style, aspect ratio, and voice open
// until the product decisions in the PRD are finalized.
export const projectAudioMixSchema = z.object({
  narrationVolume: z.number().min(0).max(1),
  musicVolume: z.number().min(0).max(1),
  musicEnabled: z.boolean(),
}).strict();

export const projectSettingsSchema = z.object({
  genre: z.enum(["cartoon", "educational"]).optional(),
  durationSeconds: z.number().int().positive().optional(),
  language: z.string().trim().min(2).max(35).optional(),
  visualStyle: z.string().trim().min(1).max(80).optional(),
  aspectRatio: z.string().trim().min(1).max(16).optional(),
  voiceId: z.string().trim().min(1).max(128).optional(),
  audioMix: projectAudioMixSchema.optional(),
}).strict();

// Provisional V1 reference-upload limits. The API must also inspect the
// uploaded bytes/media; client-provided MIME type and size are not trusted.
const MiB = 1024 * 1024;
export const assetUploadPolicy = {
  imageMimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
  videoMimeTypes: ["video/mp4", "video/quicktime"] as const,
  maxImageBytes: 20 * MiB,
  maxImageWidth: 8000,
  maxImageHeight: 8000,
  maxImagePixels: 40_000_000,
  maxVideoBytes: 100 * MiB,
  maxVideoDurationSeconds: 30,
  maxVideoWidth: 1920,
  maxVideoHeight: 1080,
  maxAssetsPerProject: 20,
  maxBytesPerUser: 1024 * MiB,
  uploadUrlTtlSeconds: 10 * 60,
  readUrlTtlSeconds: 5 * 60,
} as const;

const referenceMimeTypes = [...assetUploadPolicy.imageMimeTypes, ...assetUploadPolicy.videoMimeTypes] as const;
const referenceImageMimeTypeSet = new Set<string>(assetUploadPolicy.imageMimeTypes);

export const assetUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255).refine((value) => !/[\\/\u0000-\u001f]/.test(value), "File name contains unsupported characters."),
  contentType: z.enum(referenceMimeTypes),
  sizeBytes: z.number().int().positive().max(assetUploadPolicy.maxVideoBytes),
  rightsConfirmed: z.literal(true),
}).strict().superRefine((value, context) => {
  const limit = referenceImageMimeTypeSet.has(value.contentType) ? assetUploadPolicy.maxImageBytes : assetUploadPolicy.maxVideoBytes;
  if (value.sizeBytes > limit) {
    context.addIssue({ code: "custom", path: ["sizeBytes"], message: "File exceeds the limit for its media type." });
  }
});

export type AssetUploadRequest = z.infer<typeof assetUploadRequestSchema>;

export const assetIdParamsSchema = z.object({ assetId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();
export const assetMediaMetadataSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("image"), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("video"), width: z.number().int().positive(), height: z.number().int().positive(), durationSeconds: z.number().positive(), videoCodec: z.string().min(1).max(64) }).strict(),
]);
export const projectAssetSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i),
  fileName: z.string().min(1).max(255),
  contentType: z.enum(referenceMimeTypes),
  sizeBytes: z.number().int().positive(),
  media: assetMediaMetadataSchema,
  createdAt: z.iso.datetime(),
}).strict();
export type ProjectAsset = z.infer<typeof projectAssetSchema>;
export const projectAssetsResponseSchema = z.object({ data: z.object({ items: z.array(projectAssetSchema) }).strict() }).strict();
export const assetUploadIntentResponseSchema = z.object({
  data: z.object({
    assetId: z.string().regex(/^[a-f\d]{24}$/i),
    uploadUrl: z.url(),
    expiresAt: z.iso.datetime(),
  }).strict(),
}).strict();
export const assetCompletionResponseSchema = z.object({ data: z.object({ asset: projectAssetSchema }).strict() }).strict();
export const assetPreviewResponseSchema = z.object({ data: z.object({ url: z.url(), expiresAt: z.iso.datetime() }).strict() }).strict();

export const projectExportPolicy = {
  maxBytesPerExport: 200 * MiB,
  maxExportsPerProject: 50,
  maxBytesPerUser: 5 * 1024 * MiB,
  maxDurationSeconds: 120,
  maxWidth: 1920,
  maxHeight: 1920,
  uploadUrlTtlSeconds: 10 * 60,
  readUrlTtlSeconds: 5 * 60,
  pendingCleanupMs: 10 * 60_000,
} as const;
export const projectExportUploadRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255).refine((value) => !/[\\/\u0000-\u001f]/.test(value), "File name contains unsupported characters."),
  contentType: z.literal("video/mp4"),
  sizeBytes: z.number().int().positive().max(projectExportPolicy.maxBytesPerExport),
}).strict();
export const projectExportSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i),
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  createdAt: z.iso.datetime(),
}).strict();
export type ProjectExport = z.infer<typeof projectExportSchema>;
export const projectExportsResponseSchema = z.object({ data: z.object({ items: z.array(projectExportSchema) }).strict() }).strict();
export const projectExportUploadIntentResponseSchema = z.object({
  data: z.object({ exportId: z.string().regex(/^[a-f\d]{24}$/i), uploadUrl: z.url(), expiresAt: z.iso.datetime() }).strict(),
}).strict();
export const projectExportResponseSchema = z.object({ data: z.object({ export: projectExportSchema }).strict() }).strict();
export const projectExportFileResponseSchema = z.object({ data: z.object({ url: z.url(), expiresAt: z.iso.datetime() }).strict() }).strict();

export const narrationVoiceNames = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Zephyr"] as const;
export const narrationAssetPolicy = {
  maxBytesPerFile: 25 * MiB,
  maxAssetsPerProject: 20,
  maxBytesPerUser: 1024 * MiB,
  readUrlTtlSeconds: 5 * 60,
  pendingCleanupMs: 10 * 60_000,
} as const;
export const narrationAssetQuerySchema = z.object({ voiceName: z.enum(narrationVoiceNames) }).strict();
export const projectNarrationAssetSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i),
  storyboardId: z.string().regex(/^[a-f\d]{24}$/i),
  storyboardVersion: z.number().int().positive(),
  voiceName: z.enum(narrationVoiceNames),
  sizeBytes: z.number().int().positive(),
  createdAt: z.iso.datetime(),
}).strict();
export type ProjectNarrationAsset = z.infer<typeof projectNarrationAssetSchema>;
export const projectNarrationAssetsResponseSchema = z.object({ data: z.object({ items: z.array(projectNarrationAssetSchema) }).strict() }).strict();
export const narrationAssetResponseSchema = z.object({ data: z.object({ asset: projectNarrationAssetSchema }).strict() }).strict();

export const createProjectRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
  topic: z.string().trim().max(2_000).optional(),
  settings: projectSettingsSchema.optional(),
}).strict();

export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z.object({
  expectedRevision: z.number().int().positive(),
  title: z.string().trim().min(1).max(120).optional(),
  topic: z.string().trim().max(2_000).nullable().optional(),
  settings: projectSettingsSchema.optional(),
}).strict().refine(
  (value) => value.title !== undefined || value.topic !== undefined || value.settings !== undefined,
  "At least one project field is required.",
);

export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export const projectIdParamsSchema = z.object({ projectId: z.string().regex(/^[a-f\d]{24}$/i) }).strict();

export const listProjectsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
  status: z.enum(["active", "archived"]).default("active"),
}).strict();

export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export const projectResponseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(120),
  topic: z.string().max(2_000).optional(),
  settings: projectSettingsSchema,
  status: z.enum(["active", "archived"]),
  revision: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();

export type ProjectResponse = z.infer<typeof projectResponseSchema>;

export const createProjectResponseSchema = z.object({
  data: z.object({ project: projectResponseSchema }).strict(),
}).strict();

export const listProjectsResponseSchema = z.object({
  data: z.object({
    items: z.array(projectResponseSchema),
    nextCursor: z.string().min(1).nullable(),
  }).strict(),
}).strict();

export const projectResponseEnvelopeSchema = z.object({ data: z.object({ project: projectResponseSchema }).strict() }).strict();

export const storyboardSceneSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  narration: z.string().trim().max(4_000),
  visualDescription: z.string().trim().max(2_000),
  caption: z.string().trim().max(500),
  durationSeconds: z.number().int().min(1).max(600),
  transition: z.string().trim().max(80),
  characterReferences: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
}).strict();

export const storyboardContentSchema = z.object({
  hook: z.string().trim().max(2_000).default(""),
  closing: z.string().trim().max(2_000).default(""),
  scenes: z.array(storyboardSceneSchema).min(1).max(50),
}).strict().refine((value) => new Set(value.scenes.map((scene) => scene.id)).size === value.scenes.length, "Scene IDs must be unique.");
export type StoryboardContent = z.infer<typeof storyboardContentSchema>;

export const saveStoryboardRequestSchema = z.object({
  expectedRevision: z.number().int().positive().optional(),
  content: storyboardContentSchema,
}).strict();
export type SaveStoryboardRequest = z.infer<typeof saveStoryboardRequestSchema>;

export const storyboardResponseSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum(["draft", "approved"]),
  revision: z.number().int().positive(),
  content: storyboardContentSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
}).strict();
export type StoryboardResponse = z.infer<typeof storyboardResponseSchema>;
export const storyboardEnvelopeSchema = z.object({ data: z.object({ storyboard: storyboardResponseSchema }).strict() }).strict();
export const storyboardListEnvelopeSchema = z.object({ data: z.object({ items: z.array(storyboardResponseSchema) }).strict() }).strict();

export const createGenerationJobRequestSchema = z.object({
  storyboardId: z.string().regex(/^[a-f\d]{24}$/i),
}).strict();
export type CreateGenerationJobRequest = z.infer<typeof createGenerationJobRequestSchema>;

export const generationJobStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export const generationJobStageSchema = z.enum(["queued", "preparing", "processing_scenes", "assembling", "completed", "failed"]);
export const generationSceneProgressSchema = z.object({
  sceneId: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  status: z.enum(["queued", "running", "completed", "failed"]),
  progressPercent: z.number().int().min(0).max(100),
}).strict();
export const generationJobSchema = z.object({
  id: z.string().regex(/^[a-f\d]{24}$/i),
  projectId: z.string().regex(/^[a-f\d]{24}$/i),
  storyboardId: z.string().regex(/^[a-f\d]{24}$/i),
  storyboardVersion: z.number().int().positive(),
  provider: z.string().min(1).max(80),
  simulated: z.boolean(),
  status: generationJobStatusSchema,
  stage: generationJobStageSchema,
  progressPercent: z.number().int().min(0).max(100),
  scenes: z.array(generationSceneProgressSchema).min(1).max(50),
  videoAssetId: z.string().regex(/^[a-f\d]{24}$/i).nullable(),
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }).strict().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  startedAt: z.iso.datetime().optional(),
  completedAt: z.iso.datetime().optional(),
}).strict();
export type GenerationJob = z.infer<typeof generationJobSchema>;
export const generationJobEnvelopeSchema = z.object({ data: z.object({ job: generationJobSchema }).strict() }).strict();
export const createGenerationJobResponseSchema = z.object({
  data: z.object({
    jobId: z.string().regex(/^[a-f\d]{24}$/i),
    status: generationJobStatusSchema,
    statusUrl: z.string().min(1),
    simulated: z.boolean(),
  }).strict(),
}).strict();
export const generationVideoPreviewResponseSchema = z.object({
  data: z.object({ url: z.url(), downloadUrl: z.url(), fileName: z.string().min(1), expiresAt: z.iso.datetime() }).strict(),
}).strict();

export const instagramAccountSchema = z.object({
  username: z.string().min(1).max(80),
  accountType: z.enum(["Business", "Media_Creator"]).optional(),
  connectedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  scopes: z.array(z.string().min(1)).max(20),
}).strict();
export type InstagramAccount = z.infer<typeof instagramAccountSchema>;
export const instagramAccountResponseSchema = z.object({
  data: z.object({ configured: z.boolean(), account: instagramAccountSchema.nullable() }).strict(),
}).strict();
export const instagramConnectResponseSchema = z.object({ data: z.object({ authorizationUrl: z.url() }).strict() }).strict();

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).strict(),
}).strict();
