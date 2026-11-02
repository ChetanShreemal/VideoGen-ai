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
