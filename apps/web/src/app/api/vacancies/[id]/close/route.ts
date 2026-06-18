// BFF POST handler for Close Vacancy — proxies to NestJS POST /api/v1/vacancies/:id/close.
// Reads JWT from httpOnly session cookie — browser never handles the token directly.
// closureType: 'FILLED' | 'CANCELLED' — source-state validation is enforced by NestJS.
// FILLED sets filledAt on the vacancy row; CANCELLED leaves filledAt null.
// Both result in status='CLOSED'. This is a terminal transition (VAC-500, VAC-501).
// Reference: spec/07_security_architecture.md — SEC-003 JWT transport
// Reference: M11 Step 13 Governance — GD-13-1, GD-13-4

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import type { CloseVacancyBffResponse } from '@/features/workforce/types';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies CloseVacancyBffResponse,
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies CloseVacancyBffResponse,
      { status: 400 },
    );
  }

  const base = process.env.API_URL ?? 'http://localhost:3001';

  let apiRes: Response;
  try {
    apiRes = await fetch(`${base}/api/v1/vacancies/${id}/close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store', // Required — Next.js 14 caches fetch responses without this
    });
  } catch {
    return Response.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies CloseVacancyBffResponse,
      { status: 503 },
    );
  }

  if (apiRes.ok) {
    const data = (await apiRes.json()) as CloseVacancyBffResponse;
    return Response.json(data, { status: 200 });
  }

  let errorCode = 'INTERNAL_ERROR';
  try {
    const errBody = (await apiRes.json()) as { success: false; error?: { code: string } };
    if (errBody.error?.code) errorCode = errBody.error.code;
  } catch {
    // Use default errorCode
  }

  return Response.json(
    { success: false, error: { code: errorCode, message: 'Request failed' } } satisfies CloseVacancyBffResponse,
    { status: apiRes.status },
  );
}
