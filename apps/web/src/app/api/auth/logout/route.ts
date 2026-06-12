// BFF logout Route Handler — calls NestJS logout (best-effort), clears session cookie unconditionally.
// Cookie is always cleared even if the NestJS call fails — ensures reliable session termination.
// Reference: spec/07_security_architecture.md — Mandatory Audit Events: Logout
// Reference: spec/06_api_contracts.md — POST /api/v1/auth/logout (requires Authorization: Bearer)

import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, type BffResponse } from '@/lib/auth';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (token) {
    const apiUrl = process.env.API_URL;
    if (apiUrl) {
      try {
        await fetch(`${apiUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Intentional: NestJS call failure must not block session termination.
        // The session cookie is always cleared below regardless of this outcome.
      }
    }
  }

  const response = NextResponse.json({ success: true } satisfies BffResponse);
  response.cookies.set(SESSION_COOKIE, '', {
    ...SESSION_COOKIE_OPTIONS,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  });
  return response;
}
