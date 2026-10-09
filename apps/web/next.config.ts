import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
  // The browser always calls same-origin `/api/*` and Next forwards those calls to the API, so cookies stay
  // first-party even though the API has its own hostname. The image fixes the target at build time
  // (the `api` Compose service); the dev server falls back to the local API.
  async rewrites() {
    const target = process.env.API_PROXY_TARGET || (isProduction ? '' : 'http://localhost:4000');
    if (!target) return [];
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },
};

export default nextConfig;
