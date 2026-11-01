/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  async redirects() {
    return [
      {
        source: '/checkout',
        destination: '/cart',
        permanent: false,
      },
      {
        source: '/checkout/:path*',
        destination: '/cart',
        permanent: false,
      },
    ];
  },
  webpack(config) {
    config.module.rules.push({ test: /\.html$/, type: 'asset/source' });
    return config;
  }
};
export default nextConfig;
