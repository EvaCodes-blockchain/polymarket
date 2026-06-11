/** @type {import('next').NextConfig} */
const nextConfig = {
  // Server components can import from @/lib/server without bundling issues
  // serverExternalPackages is Next.js 15+ — not needed in 14.2.x
  reactStrictMode: true,
  images: {
    remotePatterns: [],
  },
  webpack: (config) => {
    // MetaMask SDK optionally imports @react-native-async-storage — not needed in browser
    config.resolve.alias = {
      ...config.resolve.alias,
      '@react-native-async-storage/async-storage': false,
      'pino-pretty': false,
    };
    return config;
  },
};

export default nextConfig;
