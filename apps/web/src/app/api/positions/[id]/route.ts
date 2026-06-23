// BFF PUT handler — proxies PUT /api/positions/:id → NestJS PUT /api/v1/positions/:id.
// Used for field edits and lifecycle transitions (Activate: {status:'ACTIVE'}, Freeze: {status:'FROZEN'}).
// NestJS controller uses @Put — must match here (not PATCH).
// Reads JWT from httpOnly session cookie — browser never handles the token directly.
// Reference: spec/07_security_architecture.md — SEC-003 JWT transport
// Reference: directives/02_position_management_rules.md — POS-AUTH-002, POS-AUTH-003

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import type { UpdatePositionBffResponse } from '@/features/workforce/types';

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies UpdatePositionBffResponse,
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies UpdatePositionBffResponse,
      { status: 400 },
    );
  }

  const base = process.env.API_URL ?? 'http://localhost:3001';

  let apiRes: Response;
  try {
    apiRes = await fetch(`${base}/api/v1/positions/${id}`, {
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
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies UpdatePositionBffResponse,
      { status: 503 },
    );
  }

  if (apiRes.ok) {
    const data = (await apiRes.json()) as UpdatePositionBffResponse;
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
    { success: false, error: { code: errorCode, message: 'Request failed' } } satisfies UpdatePositionBffResponse,
    { status: apiRes.status },
  );
}
