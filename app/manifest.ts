import type { MetadataRoute } from 'next';

/**
 * Served by Next at /manifest.webmanifest.
 *
 * NOTE: middleware.ts must exclude this path. Its matcher redirects anything
 * unlisted to /login, and a manifest that 302s to a sign-in page makes the app
 * silently un-installable.
 *
 * Colours are the same ones app/layout.tsx puts in the theme-colour meta tags,
 * so the splash screen and the address bar do not disagree.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Shop Books',
    short_name: 'Shop Books',
    description: 'Stock, sales and expenses for a beddings and clothings shop.',
    // Attendants land on /shop and the owner on /dashboard; '/' redirects to
    // whichever the session says, so it is the only correct start URL for both.
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#fbfafa',
    theme_color: '#fbfafa',
    lang: 'en',
    dir: 'ltr',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        // Android crops maskable icons to the launcher's shape. This one keeps
        // the mark inside the central 80% so nothing important is cut off.
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
