/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the shared workspace package so its TypeScript source
  // (packages/db/client.ts) is compiled by Next instead of needing a build step.
  transpilePackages: ["@bumi/db"],
  // Playwright + stealth are heavy Node-only native deps. Keep them out of the
  // webpack bundle and require them at runtime (server) instead.
  experimental: {
    serverComponentsExternalPackages: [
      "playwright",
      "playwright-core",
      "playwright-extra",
      "puppeteer-extra-plugin-stealth",
      "bullmq",
      "ioredis",
    ],
  },
  images: { unoptimized: true },
};

export default nextConfig;
