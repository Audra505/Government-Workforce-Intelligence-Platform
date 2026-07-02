// BFF POST handler — create application.
// Browser endpoint: POST /api/recruiting/applications
// Backend target:   POST /api/v1/applications
//
// Required body fields: candidateId (UUID), vacancyId (UUID).
// Optional body fields: notes, currentStage.
// status is set to APPLIED by NestJS — not a client field.
//
// SEC-003: tenantId is never accepted from the browser body.
// Any request body containing tenantId is rejected with 400.
// tenantId is derived from the JWT by NestJS.
//
// Reference: governance/GD-M20-1.md — Decision 3, 6, 9
// Reference: apps/api/src/recruiting/dto/create-application.dto.ts

import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

type BffResponse =
  | { success: true }
  | { success: false; error: { code: string; message: string } };

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies BffResponse,
      { status: 400 },
    );
  }

  // SEC-003: reject any body that carries tenantId.
  if ('tenantId' in body) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'tenantId must not be supplied by the client' } } satisfies BffResponse,
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
    nestRes = await fetch(`${apiUrl}/api/v1/applications`, {
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
