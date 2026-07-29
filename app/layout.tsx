import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ServiceWorkerRegistrar } from '@/components/offline/ServiceWorkerRegistrar';

const geistSans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Shop Books',
  description: 'Stock, sales and expenses for a beddings and clothings shop.',
  manifest: '/manifest.webmanifest',
  // iOS ignores the manifest for both of these and reads the meta tags instead.
  appleWebApp: {
    capable: true,
    title: 'Shop Books',
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon-180.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Attendants work one-handed on phones; keep the theme bar in step with the app.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfafa' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0b0d' },
  ],
  // Installed to a home screen, the app fills the phone. Without this the
  // status bar area is padded out on notched devices and the header floats.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
