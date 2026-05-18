/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['chromadb', '@xenova/transformers', 'ioredis'],
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
