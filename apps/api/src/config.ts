import { z } from "zod";

const environmentSchema = z.object({
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4_000),
  WEB_ORIGIN: z.url().default("http://127.0.0.1:3000"),
  BETTER_AUTH_URL: z.url().default("http://127.0.0.1:4000"),
  BETTER_AUTH_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().min(1).optional(),
  AUTH_EMAIL_FROM: z.string().min(1).default("VideoGen <onboarding@resend.dev>"),
  MONGODB_DNS_SERVERS: z
    .string()
    .optional()
    .transform((value) => value?.split(",").map((server) => server.trim()).filter(Boolean))
    .pipe(z.array(z.union([z.ipv4(), z.ipv6()])).optional()),
  MONGODB_URI: z
    .string()
    .min(1)
    .refine((value) => /^mongodb(?:\+srv)?:\/\//.test(value), "Invalid MongoDB URI"),
  MONGODB_DB_NAME: z.string().min(1),
});

const parsed = environmentSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error("Missing or invalid API configuration. Check required environment variable names.");
}

export const config = parsed.data;

const primaryWebOrigin = new URL(config.WEB_ORIGIN);
const originSet = new Set([primaryWebOrigin.origin]);
if (primaryWebOrigin.hostname === "127.0.0.1" || primaryWebOrigin.hostname === "localhost") {
  const localAlias = new URL(primaryWebOrigin.origin);
  localAlias.hostname = primaryWebOrigin.hostname === "localhost" ? "127.0.0.1" : "localhost";
  originSet.add(localAlias.origin);
}

export const trustedWebOrigins = [...originSet];
