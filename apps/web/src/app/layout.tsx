import type { Metadata } from 'next';
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
      <body>{children}</body>
    </html>
  );
}
