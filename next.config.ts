import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /*
   * Leave the database driver alone.
   *
   * `ws` optionally requires the native `bufferutil` addon at runtime. Bundling
   * it rewrites that require into something that resolves to an empty module,
   * and the driver then dies with "bufferUtil.mask is not a function" on the
   * first query — a failure that looks like a database outage and is not one.
   */
  serverExternalPackages: ['@neondatabase/serverless', 'ws'],

  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          /*
           * The worker is the one file that must never be served stale. A
           * cached sw.js pins the device to whatever caching rules shipped
           * with it, including the cache version, so a bad worker could
           * outlive several deploys. Browsers already refuse to cache it for
           * more than 24h; this makes it zero.
           */
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;
