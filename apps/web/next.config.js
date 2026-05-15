/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['chromadb', '@xenova/transformers'],
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
