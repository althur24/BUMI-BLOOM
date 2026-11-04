/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  webpack(config) {
    config.module.rules.push({ test: /\.html$/, type: 'asset/source' });
    return config;
  }
};
export default nextConfig;
