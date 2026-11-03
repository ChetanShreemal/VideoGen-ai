import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import type { MongoDatabase } from "@videogen/database";
import { config } from "./config.js";
import { sendPasswordResetEmail } from "./email.js";

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
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        try {
          await sendPasswordResetEmail(user.email, url);
        } catch {
          // Avoid logging email addresses, reset tokens, URLs, or provider credentials.
          console.error("Password reset email delivery failed.");
        }
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
  });
}
