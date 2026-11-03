import { setServers } from "node:dns";
import fastifyCors from "@fastify/cors";
import Fastify from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import {
  currentUserResponseSchema,
  healthResponseSchema,
  readinessResponseSchema,
  unauthenticatedResponseSchema,
} from "@videogen/contracts";
import { MongoDatabase } from "@videogen/database";
import { createAuth } from "./auth.js";
import { config } from "./config.js";
import { registerProjectRoutes } from "./projects/project-routes.js";
import { ProjectRepository } from "./projects/project-repository.js";

if (config.MONGODB_DNS_SERVERS?.length) {
  setServers(config.MONGODB_DNS_SERVERS);
}

const app = Fastify({
  logger: {
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.token"],
      censor: "[REDACTED]",
    },
  },
});

const database = new MongoDatabase({
  uri: config.MONGODB_URI,
  databaseName: config.MONGODB_DB_NAME,
});
const auth = createAuth(database);
const projectRepository = new ProjectRepository(database, config.BETTER_AUTH_SECRET);

await app.register(fastifyCors, {
  origin: config.WEB_ORIGIN,
  credentials: true,
});

await registerProjectRoutes(app, auth, projectRepository);

app.route({
  method: ["GET", "POST"],
  url: "/api/v1/auth/*",
  async handler(request, reply) {
    try {
      const url = new URL(request.url, config.BETTER_AUTH_URL);
      const headers = fromNodeHeaders(request.headers);
      const authRequest = new Request(url, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      });
      const response = await auth.handler(authRequest);

      reply.status(response.status);
      response.headers.forEach((value, name) => {
        if (name !== "set-cookie") reply.header(name, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);

      return reply.send(response.body ? await response.text() : null);
    } catch {
      request.log.error("Authentication request failed.");
      return reply.status(500).send({
        error: { code: "AUTH_FAILURE", message: "Authentication request failed." },
      });
    }
  },
});

app.get("/api/v1/health", async (_request, reply) => {
  const response = healthResponseSchema.parse({
    status: "ok",
    service: "videogen-api",
  });

  return reply.send(response);
});

app.get("/api/v1/me", async (request, reply) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });

  if (!session) {
    return reply.status(401).send(
      unauthenticatedResponseSchema.parse({
        error: { code: "UNAUTHENTICATED", message: "A valid session is required." },
      }),
    );
  }

  return reply.send(
    currentUserResponseSchema.parse({
      data: {
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
          emailVerified: session.user.emailVerified,
        },
      },
    }),
  );
});

app.get("/api/v1/ready", async (_request, reply) => {
  try {
    await database.ping();
    return reply.send(
      readinessResponseSchema.parse({
        status: "ready",
        service: "videogen-api",
        database: "connected",
      }),
    );
  } catch {
    return reply.status(503).send(
      readinessResponseSchema.parse({
        status: "not_ready",
        service: "videogen-api",
        database: "unavailable",
      }),
    );
  }
});

app.addHook("onClose", async () => {
  await database.close();
});

let shutdownPromise: Promise<void> | undefined;

const shutdown = (signal: NodeJS.Signals): void => {
  if (shutdownPromise) return;

  app.log.info({ signal }, "Shutting down API gracefully.");
  shutdownPromise = app.close().catch((error: unknown) => {
    app.log.error({ err: error }, "API shutdown failed.");
    process.exitCode = 1;
  });
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

try {
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
  void database.connect().catch(() => {
    app.log.error("MongoDB is unavailable; readiness checks will report not ready.");
  });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
