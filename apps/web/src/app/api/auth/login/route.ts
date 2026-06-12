// BFF login Route Handler — proxies to NestJS, sets httpOnly session cookie.
// The browser never receives the JWT; it is stored exclusively in the httpOnly cookie.
// Reference: spec/07_security_architecture.md — Login Flow, "Prohibited: JWT in Local Storage"
// Reference: spec/06_api_contracts.md — POST /api/v1/auth/login response contract
// Reference: spec/09_frontend_architecture.md — "Session Storage: Memory + Secure Cookie Strategy"

import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, type BffResponse } from '@/lib/auth';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies BffResponse,
      { status: 400 },
    );
  }

  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies BffResponse,
      { status: 500 },
    );
  }

  let nestRes: Response;
  try {
    nestRes = await fetch(`${apiUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies BffResponse,
      { status: 503 },
    );
  }

  const data = (await nestRes.json()) as {
    success: boolean;
    data?: { accessToken: string; expiresIn: number };
    error?: { code: string; message: string };
  };

  if (!nestRes.ok || !data.success || !data.data?.accessToken) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: data.error?.code ?? 'UNAUTHORIZED',
          message: data.error?.message ?? 'Authentication failed',
        },
      } satisfies BffResponse,
      { status: nestRes.ok ? 401 : nestRes.status },
    );
  }

  const response = NextResponse.json({ success: true } satisfies BffResponse);
  response.cookies.set(SESSION_COOKIE, data.data.accessToken, {
    ...SESSION_COOKIE_OPTIONS,
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}
