import { z } from "zod";

const optionalEnvironmentString = z.preprocess(
  (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

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
  R2_ACCOUNT_ID: optionalEnvironmentString,
  R2_ENDPOINT: optionalEnvironmentString.pipe(z.url().optional()),
  R2_BUCKET_NAME: optionalEnvironmentString,
  R2_REGION: optionalEnvironmentString.default("auto"),
  R2_ACCESS_KEY_ID: optionalEnvironmentString,
  R2_SECRET_ACCESS_KEY: optionalEnvironmentString,
  ASSET_UPLOADS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
}).superRefine((value, context) => {
  const r2Values = [value.R2_ACCOUNT_ID, value.R2_ENDPOINT, value.R2_BUCKET_NAME, value.R2_ACCESS_KEY_ID, value.R2_SECRET_ACCESS_KEY];
  const present = r2Values.filter(Boolean).length;
  if (present !== 0 && present !== r2Values.length) {
    context.addIssue({ code: "custom", path: ["R2_ACCESS_KEY_ID"], message: "Configure all R2 settings together or leave them all empty." });
  }
  if (value.R2_ACCOUNT_ID && !/^[a-f\d]{32}$/i.test(value.R2_ACCOUNT_ID)) {
    context.addIssue({ code: "custom", path: ["R2_ACCOUNT_ID"], message: "R2 account ID must be 32 hexadecimal characters." });
  }
  if (value.R2_ENDPOINT && value.R2_ACCOUNT_ID) {
    const expected = `https://${value.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    if (new URL(value.R2_ENDPOINT).origin !== expected) {
      context.addIssue({ code: "custom", path: ["R2_ENDPOINT"], message: "R2 endpoint must match the configured account." });
    }
  }
});

const parsed = environmentSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error("Missing or invalid API configuration. Check required environment variable names.");
}

export const config = parsed.data;

export const r2Config = config.R2_ACCOUNT_ID && config.R2_ENDPOINT && config.R2_BUCKET_NAME && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY
  ? {
      accountId: config.R2_ACCOUNT_ID,
      endpoint: config.R2_ENDPOINT,
      bucketName: config.R2_BUCKET_NAME,
      region: config.R2_REGION,
      accessKeyId: config.R2_ACCESS_KEY_ID,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    }
  : undefined;

const primaryWebOrigin = new URL(config.WEB_ORIGIN);
const originSet = new Set([primaryWebOrigin.origin]);
if (primaryWebOrigin.hostname === "127.0.0.1" || primaryWebOrigin.hostname === "localhost") {
  const localAlias = new URL(primaryWebOrigin.origin);
  localAlias.hostname = primaryWebOrigin.hostname === "localhost" ? "127.0.0.1" : "localhost";
  originSet.add(localAlias.origin);
}

export const trustedWebOrigins = [...originSet];
