// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@gov-platform/shared', '@gov-platform/ui'],
};

export default nextConfig;
