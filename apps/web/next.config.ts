import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Produce a self-contained standalone build so npm global installs
  // can run the web app with `node server.js` — no npm install or
  // next build required at runtime.
  output: "standalone",

  // Required for pnpm monorepos: trace dependencies from the workspace
  // root so the standalone build bundles its own node_modules correctly
  // instead of resolving through pnpm's virtual store symlinks.
  outputFileTracingRoot: path.join(import.meta.dirname, "..", ".."),

  // Allow long-running API routes for agent streaming
  serverExternalPackages: [],

  // Transpile ESM-only packages so webpack can bundle them
  transpilePackages: ["react-markdown", "remark-gfm"],
};

export default nextConfig;
