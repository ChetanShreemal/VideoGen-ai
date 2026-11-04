import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    // Run Next.js build workers as threads because this Windows environment blocks child-process spawn.
    workerThreads: true,
  },
  // The project's prebuild script runs `tsc --noEmit`; skip Next's duplicate worker-based check.
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
