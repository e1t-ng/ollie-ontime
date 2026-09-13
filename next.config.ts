import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.ONTIME_TARGET === 'railway' ? {output: 'standalone' as const} : {}),
};

export default nextConfig;
