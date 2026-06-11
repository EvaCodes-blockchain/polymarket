/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Server components can import from @/lib/server without bundling issues
    serverComponentsExternalPackages: ['@prisma/client', 'prisma'],
  },
};

export default nextConfig;
