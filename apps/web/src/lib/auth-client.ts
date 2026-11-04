import { createAuthClient } from "better-auth/react";

const configuredApiBaseURL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4000/api/v1";
const parsedApiBaseURL = new URL(configuredApiBaseURL);
const browserHost = typeof window === "undefined" ? undefined : window.location.hostname;
const localHosts = new Set(["localhost", "127.0.0.1"]);
if (browserHost && localHosts.has(browserHost) && localHosts.has(parsedApiBaseURL.hostname)) {
  parsedApiBaseURL.hostname = browserHost;
}

export const apiBaseURL = `${parsedApiBaseURL.origin}${parsedApiBaseURL.pathname}`.replace(/\/$/, "");

export const authClient = createAuthClient({
  baseURL: `${apiBaseURL}/auth`,
  fetchOptions: {
    credentials: "include",
  },
});
