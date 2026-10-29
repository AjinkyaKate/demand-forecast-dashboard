import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native and wasm-backed packages stay in node_modules on the server.
  serverExternalPackages: ["better-sqlite3", "sql.js"],
};

export default nextConfig;
