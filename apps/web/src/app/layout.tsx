import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { cn } from '@/lib/utils';
import './globals.css';

// Self-hosted woff2 files under public/fonts/ — Docker build does not require outbound internet access.
// CSS variables exposed; existing pages using font-sans (Tailwind system stack) are unaffected.
const ibmPlexSans = localFont({
  src: '../../public/fonts/ibm-plex-sans-latin.woff2',
  weight: '300 600',
  variable: '--font-ibm-plex-sans',
  display: 'swap',
});

const ibmPlexMono = localFont({
  src: [
    { path: '../../public/fonts/ibm-plex-mono-400-latin.woff2', weight: '400' },
    { path: '../../public/fonts/ibm-plex-mono-500-latin.woff2', weight: '500' },
  ],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Government Workforce Intelligence Platform',
  description: 'AI-Driven Staffing Optimization Platform for Government HR',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={cn('min-h-screen bg-background font-sans antialiased', ibmPlexSans.variable, ibmPlexMono.variable)}>
        {children}
      </body>
    </html>
  );
}
