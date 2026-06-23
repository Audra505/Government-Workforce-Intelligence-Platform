// BFF POST handler — proxies POST /api/positions → NestJS POST /api/v1/positions.
// Reads JWT from httpOnly session cookie; browser never contacts NestJS directly.
// tenantId derived from JWT by NestJS — not accepted from client (SEC-003).
// Status not accepted from body — NestJS defaults to DRAFT (POS-001).
// Reference: spec/07_security_architecture.md — SEC-003 JWT transport, BFF pattern
// Reference: directives/02_position_management_rules.md — POS-001, POS-AUTH-001

import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import type { CreatePositionBffResponse } from '@/features/workforce/types';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies CreatePositionBffResponse,
      { status: 400 },
    );
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies CreatePositionBffResponse,
      { status: 401 },
    );
  }

  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

  let nestRes: Response;
  try {
    nestRes = await fetch(`${apiUrl}/api/v1/positions`, {
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
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies CreatePositionBffResponse,
      { status: 503 },
    );
  }

  if (nestRes.ok) {
    const data = (await nestRes.json()) as CreatePositionBffResponse;
    return NextResponse.json(data, { status: 201 });
  }

  let nestError: { error?: { code?: string; message?: string } } = {};
  try {
    nestError = (await nestRes.json()) as typeof nestError;
  } catch {
    // fall through
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: nestError.error?.code ?? 'INTERNAL_ERROR',
        message: nestError.error?.message ?? 'An unexpected error occurred',
      },
    } satisfies CreatePositionBffResponse,
    { status: nestRes.status },
  );
}
