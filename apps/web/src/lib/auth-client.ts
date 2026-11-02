import { createAuthClient } from "better-auth/react";

export const apiBaseURL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4000/api/v1"
).replace(/\/$/, "");

export const authClient = createAuthClient({
  baseURL: `${apiBaseURL}/auth`,
  fetchOptions: {
    credentials: "include",
  },
});
