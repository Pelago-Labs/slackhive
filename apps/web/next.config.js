/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@slackhive/shared'],
  // Mark native Node modules as server-only (not bundled by webpack)
  serverExternalPackages: ['better-sqlite3', 'pg'],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Replace native modules with empty stubs on the client side.
      // These are only used server-side in API routes / server components.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        child_process: false,
        net: false,
        tls: false,
        dns: false,
      };
      config.resolve.alias = {
        ...config.resolve.alias,
        'better-sqlite3': false,
        'pg': false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
