import Fastify from "fastify";
import { healthResponseSchema } from "@videogen/contracts";

const app = Fastify({ logger: true });

app.get("/api/v1/health", async (_request, reply) => {
  const response = healthResponseSchema.parse({
    status: "ok",
    service: "videogen-api",
  });

  return reply.send(response);
});

const port = Number(process.env.API_PORT ?? 4000);
const host = process.env.API_HOST ?? "127.0.0.1";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
