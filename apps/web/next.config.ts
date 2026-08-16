import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
import path from "node:path";

// The web app lives in a workspace, while PayBench keeps its single local
// environment file at the repository root.
const workingDirectory = process.cwd();
const repositoryRoot =
  path.basename(workingDirectory) === "web" &&
  path.basename(path.dirname(workingDirectory)) === "apps"
    ? path.resolve(workingDirectory, "../..")
    : workingDirectory;
loadEnvConfig(
  repositoryRoot,
  process.env.NODE_ENV !== "production",
  console,
  true,
);

const nextConfig: NextConfig = {
  transpilePackages: ["@paybench/contracts"],
  // Replay QA can trace recorded failures back to the original React source.
  productionBrowserSourceMaps: true,
};

export default nextConfig;
