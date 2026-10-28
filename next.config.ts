import path from "node:path";
import type { NextConfig } from "next";

// StackBlitz (WebContainers) demo mode: see src/lib/runtime.ts and docs/STACKBLITZ.md.
const stackblitz =
  process.env.CLM_STACKBLITZ === "1" ||
  Boolean((process.versions as Record<string, string | undefined>).webcontainer) ||
  process.env.SHELL === "/bin/jsh";
// Same rule as dbDriver() in src/lib/runtime.ts.
const pglite = process.env.DB_DRIVER ? process.env.DB_DRIVER === "pglite" : stackblitz;

// StackBlitz shows the app inside its editor's preview frame; everywhere else the app refuses framing.
const frameAncestors = stackblitz ? "https://stackblitz.com https://*.stackblitz.com https://*.webcontainer.io https://*.webcontainer-api.io" : "'none'";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  ...(stackblitz ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value:
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'" +
      (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "") +
      `; frame-ancestors ${frameAncestors}; base-uri 'self'; form-action 'self'`,
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Self-contained server bundle for the container image (see Dockerfile).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  env: {
    NEXT_PUBLIC_MAX_UPLOAD_MB: process.env.MAX_UPLOAD_MB ?? (process.env.VERCEL ? "4" : stackblitz ? "10" : "25"),
  },
  // In PGlite mode, PGlite reaches the bundles through src/db/pglite-shim.cjs instead.
  serverExternalPackages: pglite ? ["pg"] : ["pg", "@electric-sql/pglite"],
  experimental: {
    serverActions: {
      bodySizeLimit: "26mb",
      // The StackBlitz preview proxies requests from its own domains.
      ...(stackblitz ? { allowedOrigins: ["*.webcontainer-api.io", "*.local-credentialless.webcontainer-api.io", "*.webcontainer.io", "*.stackblitz.io"] } : {}),
    },
  },
  webpack(config, { webpack, isServer }) {
    if (pglite && isServer) {
      // Keeps pages from becoming async modules, which lose request context on StackBlitz: load only the
      // PGlite driver, and get PGlite itself from src/db/pglite-shim.cjs rather than as an ES module.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/[\\/]src[\\/]db[\\/]driver\.ts$/, path.resolve(__dirname, "src/db/driver.stackblitz.ts")),
        new webpack.NormalModuleReplacementPlugin(/^@electric-sql\/pglite$/, path.resolve(__dirname, "src/db/pglite-shim.cjs")),
      );
    }
    if (stackblitz) {
      // Tailwind's native compiler can't run in the browser: use the precompiled stylesheet instead.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/[\\/]src[\\/]app[\\/]globals\.css$/, path.resolve(__dirname, "src/app/globals.prebuilt.css")),
      );
    }
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
