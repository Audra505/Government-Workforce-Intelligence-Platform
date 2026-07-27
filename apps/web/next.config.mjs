// @ts-check

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@gov-platform/shared', '@gov-platform/ui'],
  // Every route under (dashboard) reads the session cookie via cookies()
  // and renders role-dependent nav/content — but Next.js's client-side
  // Router Cache still caches a dynamic route's RSC payload by URL for
  // staleTimes.dynamic seconds (default 30s) regardless of which session
  // produced it. In a tab that has recently rendered /dashboard or
  // /intelligence under a different role (or the same role, stale), a
  // client-side <Link> navigation can briefly paint that cached render
  // before the fresh, session-correct one arrives. Setting dynamic
  // staleTime to 0 disables that cache for dynamic segments so every
  // in-app navigation always fetches a fresh, role-correct render — the
  // client-side-navigation analogue of the login/logout hard-navigation
  // fix (window.location.href in login-form.tsx / logout-button.tsx),
  // applied here without giving up SPA-style transitions for normal nav.
  experimental: {
    staleTimes: { dynamic: 0 },
  },
};

export default nextConfig;
