import { randomUUID } from "node:crypto";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId, type Collection, type Document } from "mongodb";
import { z } from "zod";
import { apiErrorResponseSchema, projectIdParamsSchema } from "@videogen/contracts";
import type { MongoDatabase } from "@videogen/database";
import type { createAuth } from "../auth.js";
import { config } from "../config.js";
import { ProjectRepository } from "../projects/project-repository.js";
import { StoryboardRepository } from "../projects/storyboard-repository.js";

type VoiceAuth = ReturnType<typeof createAuth>;
const voiceNames = ["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Zephyr"] as const;
const requestSchema = z.object({ voiceName: z.enum(voiceNames) }).strict();
const requestTimeoutMs = 90_000;
const reservationLeaseMs = 120_000;
const maxNarrationCharacters = 8_000;
const voiceRateWindowMs = 60 * 60_000;
const maxVoiceRequestsPerWindow = 10;

interface VoiceLimitDocument extends Document {
  _id: string;
  activeRequests: Array<{ requestId: string; expiresAt: Date }>;
  recentRequests: Date[];
  updatedAt: Date;
}

type VoiceReservationResult =
  | { requestId: string; limitedBy?: undefined; retryAfterSeconds?: undefined }
  | { requestId?: undefined; limitedBy: "concurrency" | "rate"; retryAfterSeconds: number };

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
  mongo: MongoDatabase,
  projects: ProjectRepository,
  storyboards: StoryboardRepository,
): Promise<void> {
  const limits: Collection<VoiceLimitDocument> = mongo.database().collection("voice_generation_limits");

  const reserveRequest = async (ownerUserId: string): Promise<VoiceReservationResult> => {
    const now = new Date();
    const requestId = randomUUID();
    const windowStart = new Date(now.getTime() - voiceRateWindowMs);
    const activeRequests = {
      $filter: {
        input: { $ifNull: ["$activeRequests", []] },
        as: "request",
        cond: { $gt: ["$$request.expiresAt", now] },
      },
    };
    const recentRequests = {
      $filter: {
        input: { $ifNull: ["$recentRequests", []] },
        as: "requestTime",
        cond: { $gt: ["$$requestTime", windowStart] },
      },
    };
    try {
      // MongoDB does not allow $expr in an upsert predicate. Ensure the owner
      // document exists first, then reserve with a conditional non-upsert update.
      try {
        await limits.updateOne(
          { _id: ownerUserId },
          { $setOnInsert: { activeRequests: [], recentRequests: [], updatedAt: now } },
          { upsert: true },
        );
      } catch (error) {
        // Another concurrent request may have inserted this owner's document.
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === 11000)) throw error;
      }
      const updated = await limits.findOneAndUpdate(
        {
          _id: ownerUserId,
          $expr: { $and: [
            { $lt: [{ $size: activeRequests }, 1] },
            { $lt: [{ $size: recentRequests }, maxVoiceRequestsPerWindow] },
          ] },
        },
        [{ $set: {
          activeRequests: { $concatArrays: [activeRequests, [{ requestId, expiresAt: new Date(now.getTime() + reservationLeaseMs) }]] },
          recentRequests: { $concatArrays: [recentRequests, [now]] },
          updatedAt: now,
        } }],
        { returnDocument: "after" },
      );
      if (updated?.activeRequests.some((request) => request.requestId === requestId)) return { requestId };

      const current = await limits.findOne({ _id: ownerUserId }, { projection: { recentRequests: 1 } });
      const currentRecentRequests = (current?.recentRequests ?? []).filter((requestTime) => requestTime > windowStart);
      if (currentRecentRequests.length >= maxVoiceRequestsPerWindow) {
        const oldestRequest = currentRecentRequests.reduce((oldest, requestTime) => requestTime < oldest ? requestTime : oldest);
        return { limitedBy: "rate", retryAfterSeconds: Math.max(1, Math.ceil((oldestRequest.getTime() + voiceRateWindowMs - now.getTime()) / 1000)) };
      }
      return { limitedBy: "concurrency", retryAfterSeconds: 60 };
    } catch (error) {
      throw error;
    }
  };

  const releaseRequest = async (ownerUserId: string, requestId: string, request: FastifyRequest): Promise<void> => {
    try {
      await limits.updateOne({ _id: ownerUserId }, { $pull: { activeRequests: { requestId } } } as Document);
    } catch {
      request.log.warn("Voice generation reservation release failed; it will expire automatically.");
    }
  };

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

      let reservation: VoiceReservationResult;
      try {
        reservation = await reserveRequest(ownerUserId);
      } catch {
        request.log.error("Voice generation limit could not be reserved.");
        return sendError(reply, 503, "VOICE_GENERATION_UNAVAILABLE", "Voice generation is temporarily unavailable.");
      }
      if (!reservation.requestId) {
        reply.header("retry-after", String(reservation.retryAfterSeconds));
        if (reservation.limitedBy === "rate") {
          return sendError(reply, 429, "VOICE_RATE_LIMITED", "You have reached the voice preview limit of 10 requests per hour. Please try again later.");
        }
        return sendError(reply, 429, "VOICE_CONCURRENCY_LIMIT", "A voice preview is already being generated for this account. Wait for it to finish before starting another.");
      }

      try {
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
      } finally {
        await releaseRequest(ownerUserId, reservation.requestId, request);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") return sendError(reply, 504, "VOICE_GENERATION_TIMEOUT", "Voice generation took too long. Try again.");
      request.log.error("Narration generation failed.");
      return sendError(reply, 503, "VOICE_GENERATION_UNAVAILABLE", "Voice generation is temporarily unavailable.");
    }
  });
}
