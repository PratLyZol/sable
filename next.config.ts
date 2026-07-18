import type { NextConfig } from "next";

// @solana/web3.js and @solana/spl-token are deliberately BUNDLED (not in
// serverExternalPackages): externalizing them makes serverless runtimes
// require() them raw, and web3.js's CJS dep rpc-websockets require()s an
// ESM-only uuid — ERR_REQUIRE_ESM on older Node runtimes. Bundling resolves
// the ESM/CJS mix at build time.
const nextConfig: NextConfig = {};

export default nextConfig;
