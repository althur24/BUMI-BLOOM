/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Transpile the shared workspace package so its TypeScript source
  // (packages/db/client.ts) is compiled by Next instead of needing a build step.
  transpilePackages: ["@bumi/db"],
  images: { unoptimized: true },
};

export default nextConfig;
