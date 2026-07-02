// BFF POST handler — create a new offer in DRAFT status.
// Browser endpoint: POST /api/recruiting/offers
// Backend target:   POST /api/v1/offers  (201, returns offer record)
//
// Required body fields: applicationId (UUID)
// Optional body fields: offerDate (ISO 8601), notes (max 5000 chars)
// Backend preconditions: application.status = OFFER; no active offer exists
//   — APPLICATION_NOT_AT_OFFER_STATUS (422), ACTIVE_OFFER_EXISTS (409)
//
// SEC-003: tenantId is never accepted from the browser body.
// Any request body containing tenantId is rejected with 400.
// tenantId is derived from the JWT by NestJS.
//
// Reference: governance/GD-M20-1.md — Decision 3, 7 (Offers)
// Reference: apps/api/src/recruiting/offer.controller.ts — POST /offers (line 74)
// Reference: apps/api/src/recruiting/dto/create-offer.dto.ts

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

  if (!body.applicationId || typeof body.applicationId !== 'string') {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'applicationId is required' } } satisfies BffResponse,
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
    nestRes = await fetch(`${apiUrl}/api/v1/offers`, {
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
        code:    nestError.error?.code    ?? 'INTERNAL_ERROR',
        message: nestError.error?.message ?? 'An unexpected error occurred',
      },
    } satisfies BffResponse,
    { status: nestRes.status },
  );
}
