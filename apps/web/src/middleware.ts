// Edge Middleware — route protection via session cookie presence check.
// Phase 1: cookie presence only. JWT signature/expiry validation deferred to Phase 2 (jose).
// Reference: spec/09_frontend_architecture.md — Protected Routes, Session Validation on Route Change
// Reference: spec/07_security_architecture.md — SEC-004 Defense in Depth
// Reference: lib/auth.ts — SESSION_COOKIE constant (no next/headers, Edge-compatible)

import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;

  const isProtected =
    pathname.startsWith('/dashboard') ||
    pathname.startsWith('/workforce') ||
    pathname.startsWith('/recruiting');

  if (isProtected && !sessionCookie) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  if (pathname === '/login' && sessionCookie) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

// Matcher runs middleware only on routes that require auth enforcement.
// /dashboard/:path*  — all current and future dashboard sub-routes (protected)
// /workforce/:path*  — all Phase 2 workforce management routes (SEC-004 Layer 1)
// /recruiting/:path* — all Phase 3 recruiting routes (M20; SEC-004 Layer 1)
// /login             — already-authenticated redirect (public, but intercepted for UX)
// /api/auth/*        — intentionally excluded: BFF handlers manage their own session logic
// /unauthorized      — intentionally excluded: must be publicly reachable as a redirect target
export const config = {
  matcher: ['/dashboard/:path*', '/workforce/:path*', '/recruiting/:path*', '/login'],
};
