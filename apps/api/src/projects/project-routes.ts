import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import {
  apiErrorResponseSchema,
  createProjectRequestSchema,
  createProjectResponseSchema,
  listProjectsQuerySchema,
  listProjectsResponseSchema,
  unauthenticatedResponseSchema,
} from "@videogen/contracts";
import type { createAuth } from "../auth.js";
import { InvalidProjectCursorError, ProjectRepository } from "./project-repository.js";

type ProjectAuth = ReturnType<typeof createAuth>;

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send(apiErrorResponseSchema.parse({ error: { code, message } }));
}

async function requireUser(request: FastifyRequest, reply: FastifyReply, auth: ProjectAuth) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      reply.status(401).send(unauthenticatedResponseSchema.parse({
        error: { code: "UNAUTHENTICATED", message: "A valid session is required." },
      }));
      return undefined;
    }
    return session.user.id;
  } catch {
    sendError(reply, 503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.");
    return undefined;
  }
}

export async function registerProjectRoutes(
  app: FastifyInstance,
  auth: ProjectAuth,
  projects: ProjectRepository,
): Promise<void> {
  app.post("/api/v1/projects", async (request, reply) => {
    const ownerUserId = await requireUser(request, reply, auth);
    if (!ownerUserId) return;

    const input = createProjectRequestSchema.safeParse(request.body);
    if (!input.success) return sendError(reply, 400, "VALIDATION_ERROR", "Project input is invalid.");

    try {
      const project = await projects.create(ownerUserId, input.data);
      return reply.status(201).send(createProjectResponseSchema.parse({ data: { project } }));
    } catch {
      request.log.error("Project creation failed.");
      return sendError(reply, 503, "PROJECTS_UNAVAILABLE", "Projects are temporarily unavailable.");
    }
  });

  app.get("/api/v1/projects", async (request, reply) => {
    const ownerUserId = await requireUser(request, reply, auth);
    if (!ownerUserId) return;

    const query = listProjectsQuerySchema.safeParse(request.query);
    if (!query.success) return sendError(reply, 400, "VALIDATION_ERROR", "Project list query is invalid.");

    try {
      const result = await projects.list(ownerUserId, query.data);
      return reply.send(listProjectsResponseSchema.parse({ data: result }));
    } catch (error) {
      if (error instanceof InvalidProjectCursorError) {
        return sendError(reply, 400, "INVALID_CURSOR", "Project list cursor is invalid.");
      }
      request.log.error("Project listing failed.");
      return sendError(reply, 503, "PROJECTS_UNAVAILABLE", "Projects are temporarily unavailable.");
    }
  });
}
