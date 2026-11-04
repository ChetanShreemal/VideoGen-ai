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

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }).strict(),
}).strict();
