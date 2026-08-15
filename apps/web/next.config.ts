import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@paybench/contracts"],
};

export default nextConfig;
