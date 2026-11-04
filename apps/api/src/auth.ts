import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import type { MongoDatabase } from "@videogen/database";
import { config, trustedWebOrigins } from "./config.js";
import { sendPasswordResetEmail } from "./email.js";
import { provisionPersonalWorkspace } from "./projects/project-repository.js";

export function createAuth(database: MongoDatabase) {
  return betterAuth({
    database: mongodbAdapter(database.database(), {
      client: database.clientHandle(),
    }),
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    basePath: "/api/v1/auth",
    trustedOrigins: trustedWebOrigins,
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await provisionPersonalWorkspace(database, user.id);
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        try {
          const resetUrl = new URL("/reset-password", config.WEB_ORIGIN);
          resetUrl.searchParams.set("token", token);
          await sendPasswordResetEmail(user.email, resetUrl.toString());
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
