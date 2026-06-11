import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Server components can import from @/lib/server without bundling issues
  serverExternalPackages: ['@prisma/client', 'prisma'],
};

export default nextConfig;
