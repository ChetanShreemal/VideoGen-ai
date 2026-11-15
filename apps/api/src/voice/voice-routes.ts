import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { apiErrorResponseSchema, projectIdParamsSchema } from "@videogen/contracts";
import type { createAuth } from "../auth.js";
import { config } from "../config.js";
import { ProjectRepository } from "../projects/project-repository.js";
import { StoryboardRepository } from "../projects/storyboard-repository.js";

type VoiceAuth = ReturnType<typeof createAuth>;
const voiceNames = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Zephyr"] as const;
const requestSchema = z.object({ voiceName: z.enum(voiceNames) }).strict();
const requestTimeoutMs = 90_000;
const maxNarrationCharacters = 8_000;

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send(apiErrorResponseSchema.parse({ error: { code, message } }));
}

async function requireUser(request: FastifyRequest, reply: FastifyReply, auth: VoiceAuth): Promise<string | undefined> {
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

function extractWav(payload: unknown): Buffer | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const response = payload as {
    output_audio?: { data?: unknown };
    steps?: Array<{ content?: Array<{ type?: unknown; data?: unknown }> }>;
  };
  const stepAudio = response.steps?.flatMap((step) => step.content ?? []).find((item) => item.type === "audio" && typeof item.data === "string")?.data;
  const encoded = typeof response.output_audio?.data === "string" ? response.output_audio.data : stepAudio;
  if (typeof encoded !== "string" || encoded.length === 0) return undefined;
  const audio = Buffer.from(encoded, "base64");
  return audio.length > 44 && audio.toString("ascii", 0, 4) === "RIFF" && audio.toString("ascii", 8, 12) === "WAVE" ? audio : undefined;
}

export async function registerVoiceRoutes(
  app: FastifyInstance,
  auth: VoiceAuth,
  projects: ProjectRepository,
  storyboards: StoryboardRepository,
): Promise<void> {
  app.post("/api/v1/projects/:projectId/storyboards/:storyboardId/narration-audio", async (request, reply) => {
    const ownerUserId = await requireUser(request, reply, auth);
    if (!ownerUserId) return;

    const rawParams = request.params as { projectId?: string; storyboardId?: string };
    const projectParams = projectIdParamsSchema.safeParse({ projectId: rawParams.projectId });
    const storyboardId = rawParams.storyboardId;
    const input = requestSchema.safeParse(request.body);
    if (!projectParams.success || !/^[a-f\d]{24}$/i.test(storyboardId ?? "") || !input.success) {
      return sendError(reply, 400, "VALIDATION_ERROR", "Choose a supported narration voice and provide valid project and storyboard IDs.");
    }
    const voiceName = input.data.voiceName;
    if (!config.GEMINI_API_KEY) return sendError(reply, 503, "VOICE_PROVIDER_UNAVAILABLE", "Voice generation is not configured on the API server.");

    try {
      const projectId = new ObjectId(projectParams.data.projectId);
      const project = await projects.get(ownerUserId, projectId);
      if (!project) return sendError(reply, 404, "PROJECT_NOT_FOUND", "Project was not found.");
      if (project.status !== "active") return sendError(reply, 409, "PROJECT_NOT_ACTIVE", "Restore this project before generating narration.");

      const storyboard = await storyboards.getOwnedVersion(ownerUserId, projectId, new ObjectId(storyboardId));
      if (!storyboard) return sendError(reply, 404, "STORYBOARD_NOT_FOUND", "Storyboard was not found.");
      const narration = [storyboard.content.hook, ...storyboard.content.scenes.map((scene) => scene.narration), storyboard.content.closing]
        .map((part) => part.trim()).filter(Boolean).join("\n\n");
      if (!narration) return sendError(reply, 400, "NARRATION_EMPTY", "Add narration to the storyboard before generating a voice preview.");
      if (narration.length > maxNarrationCharacters) return sendError(reply, 413, "NARRATION_TOO_LONG", "This storyboard is too long for one voice preview. Shorten the narration and try again.");

      const providerResponse = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": config.GEMINI_API_KEY },
        signal: AbortSignal.timeout(requestTimeoutMs),
        body: JSON.stringify({
          model: "gemini-3.8-flash-lite-tts",
          input: [{
            type: "user_input",
            content: [{
              type: "text",
              text: narration,
              annotations: [{ type: "speech_metadata", style: "Clear, natural educational narration at a measured pace." }],
            }],
          }],
          response_format: { type: "audio" },
          generation_config: { speech_config: [{ voice: voiceName }] },
          store: false,
        }),
      });
      if (!providerResponse.ok) {
        request.log.warn({ statusCode: providerResponse.status }, "Gemini narration request failed.");
        return sendError(reply, providerResponse.status === 429 ? 429 : 502, providerResponse.status === 429 ? "VOICE_QUOTA_EXCEEDED" : "VOICE_GENERATION_FAILED", providerResponse.status === 429 ? "Gemini's free-tier voice limit was reached. Try again later." : "Gemini could not generate this voice preview. Try again.");
      }

      const wav = extractWav(await providerResponse.json());
      if (!wav) {
        request.log.warn("Gemini narration response did not contain a valid WAV file.");
        return sendError(reply, 502, "VOICE_GENERATION_FAILED", "Gemini returned an audio format the app could not play.");
      }
      return reply
        .header("content-type", "audio/wav")
        .header("content-disposition", `inline; filename=videogen-narration-v${storyboard.version}.wav`)
        .header("cache-control", "no-store")
        .header("x-videogen-storyboard-version", String(storyboard.version))
        .send(wav);
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") return sendError(reply, 504, "VOICE_GENERATION_TIMEOUT", "Voice generation took too long. Try again.");
      request.log.error("Narration generation failed.");
      return sendError(reply, 503, "VOICE_GENERATION_UNAVAILABLE", "Voice generation is temporarily unavailable.");
    }
  });
}
