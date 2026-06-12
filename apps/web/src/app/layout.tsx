import type { Metadata } from 'next';
import { cn } from '@/lib/utils';
import './globals.css';

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
      <body className={cn('min-h-screen bg-background font-sans antialiased')}>
        {children}
      </body>
    </html>
  );
}
