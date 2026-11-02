import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import type { MongoDatabase } from "@videogen/database";
import { config } from "./config.js";

export function createAuth(database: MongoDatabase) {
  return betterAuth({
    database: mongodbAdapter(database.database(), {
      client: database.clientHandle(),
    }),
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    basePath: "/api/v1/auth",
    trustedOrigins: [config.WEB_ORIGIN],
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
  });
}
