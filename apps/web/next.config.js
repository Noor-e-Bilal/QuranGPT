/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['chromadb', '@xenova/transformers'],
  },
};

module.exports = nextConfig;
