import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep development and production compiler state separate. On Windows, running
  // `next build` while the dev server is open can otherwise corrupt Turbopack's
  // shared persistence files and leave the UI stuck compiling the error route.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  // standalone output: next build additionally emits .next/standalone (minimal server.js + nft-traced dependency subset),
  // used by the Electron main process to fork-start the server without requiring npm install on the user's machine. Does not affect next dev.
  output: "standalone",
  // better-sqlite3 is a native module; mark it external (loaded via require, so the bundler won't try to bundle its .node file)
  serverExternalPackages: ["better-sqlite3"],
  // Keep the file trace honest: nft's conservative directory collection was dragging the local
  // data/ (user uploads/outputs — 96MB of it), the docs site and other repo-only folders into
  // .next/standalone, which then shipped inside every desktop installer (issue: 330MB dmg).
  // data/ is a runtime-created directory (Electron uses userData anyway), never a build input.
  outputFileTracingExcludes: {
    "/**": ["./.git/**", "./.github/**", "./.next-dev/**", "./data/**", "./docs/**", "./tasks/**", "./release/**", "./e2e/**", "./remotion/**"],
  },
};

export default nextConfig;
