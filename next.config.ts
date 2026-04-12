import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GIT_SHA:
      process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
};

export default nextConfig;
