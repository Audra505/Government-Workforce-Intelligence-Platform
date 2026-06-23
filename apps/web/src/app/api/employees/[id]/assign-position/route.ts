// BFF POST handler for employee position assignment, reassignment, and clearance.
// Reads JWT from httpOnly session cookie — browser never handles the token directly.
// Proxies to NestJS POST /api/v1/employees/:id/assign-position.
// positionId=UUID → assign or reassign (GD-M15-1 D5).
// positionId=null → clearance; PENDING_ONBOARDING only (GD-M15-1 D6).
// tenantId derived from JWT by NestJS — not accepted from client (SEC-003).
// Reference: spec/07_security_architecture.md — SEC-003 JWT transport
// Reference: governance/GD-M15-1.md — Decision 5, 6, 9, 10

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import type { AssignPositionBffResponse } from '@/features/workforce/types';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies AssignPositionBffResponse,
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies AssignPositionBffResponse,
      { status: 400 },
    );
  }

  const base = process.env.API_URL ?? 'http://localhost:3001';

  let apiRes: Response;
  try {
    apiRes = await fetch(`${base}/api/v1/employees/${id}/assign-position`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies AssignPositionBffResponse,
      { status: 503 },
    );
  }

  if (apiRes.ok) {
    const data = (await apiRes.json()) as AssignPositionBffResponse;
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
    { success: false, error: { code: errorCode, message: 'Request failed' } } satisfies AssignPositionBffResponse,
    { status: apiRes.status },
  );
}
