import { createCipheriv, createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { ObjectId, type Document } from "mongodb";
import { z } from "zod";
import { instagramAccountResponseSchema, instagramConnectResponseSchema } from "@videogen/contracts";
import type { MongoDatabase } from "@videogen/database";
import type { createAuth } from "../auth.js";
import { config, trustedWebOrigins } from "../config.js";
import type { ProjectRepository } from "../projects/project-repository.js";

type SocialAuth = ReturnType<typeof createAuth>;
type InstagramState = {
  stateHash: string;
  ownerUserId: string;
  workspaceId: ObjectId;
  returnOrigin: string;
  expiresAt: Date;
  createdAt: Date;
};
type InstagramAccountDocument = {
  workspaceId: ObjectId;
  platform: "instagram";
  instagramUserId: string;
  username: string;
  accountType?: "Business" | "Media_Creator";
  encryptedAccessToken: string;
  scopes: string[];
  connectedAt: Date;
  expiresAt: Date;
  updatedAt: Date;
};

const callbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(32).max(256).optional(),
  error: z.string().max(120).optional(),
}).passthrough();
const tokenValueSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive().optional(),
  permissions: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
}).passthrough();
const tokenResponseSchema = z.object({
  access_token: z.string().min(1).optional(),
  expires_in: z.coerce.number().int().positive().optional(),
  permissions: z.string().optional(),
  user_id: z.union([z.string(), z.number()]).optional(),
  data: z.array(tokenValueSchema).optional(),
}).passthrough().refine((value) => Boolean(value.access_token ?? value.data?.[0]?.access_token));
const profileResponseSchema = z.object({
  user_id: z.union([z.string(), z.number()]).optional(),
  username: z.string().min(1).optional(),
  account_type: z.enum(["Business", "Media_Creator"]).optional(),
  data: z.array(z.object({
    user_id: z.union([z.string(), z.number()]).optional(),
    username: z.string().min(1).optional(),
    account_type: z.enum(["Business", "Media_Creator"]).optional(),
  }).passthrough()).optional(),
}).passthrough();

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.status(statusCode).send({ error: { code, message } });
}

async function requireUser(request: FastifyRequest, reply: FastifyReply, auth: SocialAuth) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      sendError(reply, 401, "UNAUTHENTICATED", "A valid session is required.");
      return undefined;
    }
    return session.user.id;
  } catch {
    sendError(reply, 503, "AUTH_UNAVAILABLE", "Authentication is temporarily unavailable.");
    return undefined;
  }
}

function instagramConfig() {
  const { INSTAGRAM_APP_ID, INSTAGRAM_APP_SECRET, INSTAGRAM_REDIRECT_URI, SOCIAL_TOKEN_ENCRYPTION_KEY } = config;
  if (!INSTAGRAM_APP_ID || !INSTAGRAM_APP_SECRET || !INSTAGRAM_REDIRECT_URI || !SOCIAL_TOKEN_ENCRYPTION_KEY) return undefined;
  return {
    appId: INSTAGRAM_APP_ID,
    appSecret: INSTAGRAM_APP_SECRET,
    redirectUri: INSTAGRAM_REDIRECT_URI,
    encryptionKey: Buffer.from(SOCIAL_TOKEN_ENCRYPTION_KEY, "hex"),
  };
}

function encryptAccessToken(token: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1.${iv.toString("hex")}.${cipher.getAuthTag().toString("hex")}.${ciphertext.toString("hex")}`;
}

function stateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function accountView(account: InstagramAccountDocument) {
  return {
    username: account.username,
    ...(account.accountType ? { accountType: account.accountType } : {}),
    connectedAt: account.connectedAt.toISOString(),
    expiresAt: account.expiresAt.toISOString(),
    scopes: account.scopes,
  };
}

function settingsRedirect(status: "connected" | "cancelled" | "error", origin: string) {
  const url = new URL("/settings/instagram", origin);
  url.searchParams.set("instagram", status);
  return url.toString();
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error("Instagram authorization request failed.");
  return response.json();
}

export async function registerInstagramRoutes(
  app: FastifyInstance,
  auth: SocialAuth,
  database: MongoDatabase,
  projects: ProjectRepository,
): Promise<void> {
  const mongo = database.database();
  const states = mongo.collection<InstagramState & Document>("instagram_oauth_states");
  const accounts = mongo.collection<InstagramAccountDocument & Document>("social_accounts");
  let indexSetup: Promise<void> | undefined;
  const ensureIndexes = () => {
    indexSetup ??= Promise.all([
      states.createIndex({ stateHash: 1 }, { unique: true, name: "instagram_oauth_state_unique" }),
      states.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "instagram_oauth_state_expiry" }),
      accounts.createIndex({ workspaceId: 1, platform: 1 }, { unique: true, name: "social_account_workspace_platform_unique" }),
    ]).then(() => undefined);
    return indexSetup;
  };

  app.get("/api/v1/instagram/account", async (request, reply) => {
    const ownerUserId = await requireUser(request, reply, auth);
    if (!ownerUserId) return;
    try {
      await ensureIndexes();
      const workspaceId = await projects.ensurePersonalWorkspace(ownerUserId);
      const account = await accounts.findOne({ workspaceId, platform: "instagram" });
      return reply.send(instagramAccountResponseSchema.parse({
        data: { configured: Boolean(instagramConfig()), account: account ? accountView(account) : null },
      }));
    } catch {
      request.log.error("Instagram account lookup failed.");
      return sendError(reply, 503, "INSTAGRAM_UNAVAILABLE", "Instagram account status is temporarily unavailable.");
    }
  });

  app.post("/api/v1/instagram/oauth/start", async (request, reply) => {
    const ownerUserId = await requireUser(request, reply, auth);
    if (!ownerUserId) return;
    const currentConfig = instagramConfig();
    if (!currentConfig) return sendError(reply, 503, "INSTAGRAM_NOT_CONFIGURED", "Instagram account connection is not configured yet.");
    try {
      await ensureIndexes();
      const workspaceId = await projects.ensurePersonalWorkspace(ownerUserId);
      const state = randomBytes(32).toString("base64url");
      const origin = request.headers.origin;
      const returnOrigin = origin && trustedWebOrigins.includes(origin) ? origin : config.WEB_ORIGIN;
      const now = new Date();
      await states.insertOne({
        stateHash: stateHash(state),
        ownerUserId,
        workspaceId,
        returnOrigin,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 10 * 60_000),
      });
      const authorizationUrl = new URL("https://www.instagram.com/oauth/authorize");
      authorizationUrl.searchParams.set("client_id", currentConfig.appId);
      authorizationUrl.searchParams.set("redirect_uri", currentConfig.redirectUri);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("scope", "instagram_business_basic");
      authorizationUrl.searchParams.set("state", state);
      return reply.send(instagramConnectResponseSchema.parse({ data: { authorizationUrl: authorizationUrl.toString() } }));
    } catch {
      request.log.error("Instagram login could not be started.");
      return sendError(reply, 503, "INSTAGRAM_UNAVAILABLE", "Instagram login could not be started. Try again shortly.");
    }
  });

  app.get("/api/v1/instagram/oauth/callback", async (request, reply) => {
    const currentConfig = instagramConfig();
    if (!currentConfig) return reply.redirect(settingsRedirect("error", config.WEB_ORIGIN));
    const parsed = callbackQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.redirect(settingsRedirect("error", config.WEB_ORIGIN));
    const { code, state, error } = parsed.data;
    if (!state) return reply.redirect(settingsRedirect("error", config.WEB_ORIGIN));
    let returnOrigin = config.WEB_ORIGIN;

    try {
      await ensureIndexes();
      const stateRecord = await states.findOneAndDelete({
        stateHash: stateHash(state),
        expiresAt: { $gt: new Date() },
      });
      if (!stateRecord) return reply.redirect(settingsRedirect("error", config.WEB_ORIGIN));
      returnOrigin = stateRecord.returnOrigin;
      if (error || !code) return reply.redirect(settingsRedirect("cancelled", stateRecord.returnOrigin));

      const form = new FormData();
      form.set("client_id", currentConfig.appId);
      form.set("client_secret", currentConfig.appSecret);
      form.set("grant_type", "authorization_code");
      form.set("redirect_uri", currentConfig.redirectUri);
      form.set("code", code.replace(/#_$/, ""));
      const shortLived = tokenResponseSchema.parse(await responseJson(await fetch("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(12_000),
      })));
      const shortToken = shortLived.data?.[0] ?? shortLived;
      if (!shortToken.access_token) throw new Error("Instagram did not return an access token.");
      const longLivedUrl = new URL("https://graph.instagram.com/access_token");
      longLivedUrl.searchParams.set("grant_type", "ig_exchange_token");
      longLivedUrl.searchParams.set("client_secret", currentConfig.appSecret);
      longLivedUrl.searchParams.set("access_token", shortToken.access_token);
      const longLived = tokenResponseSchema.parse(await responseJson(await fetch(longLivedUrl, { signal: AbortSignal.timeout(12_000) })));
      if (!longLived.access_token) throw new Error("Instagram did not return a long-lived access token.");

      const profileUrl = new URL(`https://graph.instagram.com/${config.INSTAGRAM_API_VERSION}/me`);
      profileUrl.searchParams.set("fields", "user_id,username,account_type");
      profileUrl.searchParams.set("access_token", longLived.access_token);
      const profile = profileResponseSchema.parse(await responseJson(await fetch(profileUrl, { signal: AbortSignal.timeout(12_000) })));
      const instagramProfile = profile.data?.[0] ?? profile;
      const instagramUserId = String(instagramProfile.user_id ?? longLived.user_id ?? shortToken.user_id ?? "");
      if (!instagramUserId || !instagramProfile.username) throw new Error("Instagram profile response was incomplete.");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + (longLived.expires_in ?? 60 * 24 * 60 * 60) * 1000);
      const scopes = (shortToken.permissions ?? "instagram_business_basic").split(",").map((scope: string) => scope.trim()).filter(Boolean);
      const account: InstagramAccountDocument = {
        workspaceId: stateRecord.workspaceId,
        platform: "instagram",
        instagramUserId,
        username: instagramProfile.username,
        ...(instagramProfile.account_type ? { accountType: instagramProfile.account_type } : {}),
        encryptedAccessToken: encryptAccessToken(longLived.access_token, currentConfig.encryptionKey),
        scopes,
        connectedAt: now,
        expiresAt,
        updatedAt: now,
      };
      await accounts.updateOne(
        { workspaceId: account.workspaceId, platform: account.platform },
        { $set: account },
        { upsert: true },
      );
      return reply.redirect(settingsRedirect("connected", stateRecord.returnOrigin));
    } catch {
      request.log.error("Instagram account authorization failed.");
      return reply.redirect(settingsRedirect("error", returnOrigin));
    }
  });

  app.delete("/api/v1/instagram/account", async (request, reply) => {
    const ownerUserId = await requireUser(request, reply, auth);
    if (!ownerUserId) return;
    try {
      await ensureIndexes();
      const workspaceId = await projects.ensurePersonalWorkspace(ownerUserId);
      await accounts.deleteOne({ workspaceId, platform: "instagram" });
      return reply.status(204).send();
    } catch {
      request.log.error("Instagram account disconnect failed.");
      return sendError(reply, 503, "INSTAGRAM_UNAVAILABLE", "Instagram account could not be disconnected. Try again shortly.");
    }
  });
}
