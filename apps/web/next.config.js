/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['chromadb', '@xenova/transformers', 'ioredis', 'mongodb'],
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
