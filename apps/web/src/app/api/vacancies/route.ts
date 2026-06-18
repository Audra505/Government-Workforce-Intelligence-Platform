// BFF vacancy Route Handler — proxies POST /api/vacancies → NestJS POST /api/v1/vacancies.
// Reads JWT from httpOnly session cookie; browser never contacts NestJS directly.
// tenantId is never in the request body — NestJS derives it from the JWT (SEC-003).
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation, BFF pattern
// Reference: apps/api/src/workforce/vacancy.controller.ts — POST /api/v1/vacancies (lines 74–118)
// Reference: apps/api/src/workforce/dto/create-vacancy.dto.ts — expected body shape

import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

type BffResponse =
  | { success: true }
  | { success: false; error: { code: string; message: string } };

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

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies BffResponse,
      { status: 401 },
    );
  }

  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

  let nestRes: Response;
  try {
    nestRes = await fetch(`${apiUrl}/api/v1/vacancies`, {
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
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies BffResponse,
      { status: 503 },
    );
  }

  if (nestRes.ok) {
    return NextResponse.json({ success: true } satisfies BffResponse, { status: 201 });
  }

  let nestError: { error?: { code?: string; message?: string } } = {};
  try {
    nestError = (await nestRes.json()) as typeof nestError;
  } catch {
    // body parse failed — fall through to generic error
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: nestError.error?.code ?? 'INTERNAL_ERROR',
        message: nestError.error?.message ?? 'An unexpected error occurred',
      },
    } satisfies BffResponse,
    { status: nestRes.status },
  );
}
