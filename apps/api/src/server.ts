import { setServers } from "node:dns";
import Fastify from "fastify";
import { healthResponseSchema, readinessResponseSchema } from "@videogen/contracts";
import { MongoDatabase } from "@videogen/database";
import { config } from "./config.js";

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

app.get("/api/v1/health", async (_request, reply) => {
  const response = healthResponseSchema.parse({
    status: "ok",
    service: "videogen-api",
  });

  return reply.send(response);
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
