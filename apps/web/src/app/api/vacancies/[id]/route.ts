// BFF PUT handler for vacancy edit and DRAFT→OPEN transition.
// Reads JWT from httpOnly session cookie — browser never handles the token directly.
// Proxies to NestJS PUT /api/v1/vacancies/:id.
// Both field updates and status:'OPEN' transition use this same handler.
// Reference: spec/07_security_architecture.md — SEC-003 JWT transport
// Reference: M11 Step 12 Governance — GD-12-2, GD-12-4

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import type { UpdateVacancyBffResponse } from '@/features/workforce/types';

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies UpdateVacancyBffResponse,
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies UpdateVacancyBffResponse,
      { status: 400 },
    );
  }

  const base = process.env.API_URL ?? 'http://localhost:3001';

  let apiRes: Response;
  try {
    apiRes = await fetch(`${base}/api/v1/vacancies/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies UpdateVacancyBffResponse,
      { status: 503 },
    );
  }

  if (apiRes.ok) {
    const data = (await apiRes.json()) as UpdateVacancyBffResponse;
    return Response.json(data, { status: 200 });
  }

  // Attempt to extract specific error code from NestJS response body.
  let errorCode = 'INTERNAL_ERROR';
  try {
    const errBody = (await apiRes.json()) as { success: false; error?: { code: string } };
    if (errBody.error?.code) {
      errorCode = errBody.error.code;
    }
  } catch {
    // Use default errorCode
  }

  return Response.json(
    { success: false, error: { code: errorCode, message: 'Request failed' } } satisfies UpdateVacancyBffResponse,
    { status: apiRes.status },
  );
}
