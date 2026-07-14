// BFF POST handler — proxies POST /api/users → NestJS POST /api/v1/users.
// JWT read from httpOnly session cookie; browser never contacts NestJS directly.
// SEC-003: tenantId must NEVER be forwarded; rejected with 400 if present in body.
// Reference: governance/GD-M26-1.md — Decision 4

import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import type { CreateUserBffResponse } from '@/features/admin/types';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies CreateUserBffResponse,
      { status: 400 },
    );
  }

  // SEC-003: reject if client attempted to forward tenantId
  if ('tenantId' in body) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'tenantId is not accepted' } } satisfies CreateUserBffResponse,
      { status: 400 },
    );
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies CreateUserBffResponse,
      { status: 401 },
    );
  }

  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

  let nestRes: Response;
  try {
    nestRes = await fetch(`${apiUrl}/api/v1/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies CreateUserBffResponse,
      { status: 503 },
    );
  }

  if (nestRes.ok) {
    const data = (await nestRes.json()) as CreateUserBffResponse;
    return NextResponse.json(data, { status: 201 });
  }

  let nestError: { error?: { code?: string; message?: string } } = {};
  try {
    nestError = (await nestRes.json()) as typeof nestError;
  } catch {
    // fall through — nestError stays as empty object
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: nestError.error?.code ?? 'INTERNAL_ERROR',
        message: nestError.error?.message ?? 'An unexpected error occurred',
      },
    } satisfies CreateUserBffResponse,
    { status: nestRes.status },
  );
}
