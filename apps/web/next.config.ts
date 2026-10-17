import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export only when building for the desktop shell (NEXT_OUTPUT=export).
  ...(process.env.NEXT_OUTPUT === "export" ? { output: "export" as const } : {}),
  images: { unoptimized: true },
  transpilePackages: ["@erp/client"],
  trailingSlash: true,
  // Do not let `next dev` write an AGENTS.md into the app folder.
  agentRules: false,
};

export default nextConfig;
