// BFF POST handler for employee status change.
// Reads JWT from httpOnly session cookie — browser never handles the token directly.
// Proxies to NestJS POST /api/v1/employees/:id/status.
// GD-M12-1: allowed transitions enforced by NestJS; BFF propagates INVALID_TRANSITION code.
// EMP-302: SEPARATED employees rejected by NestJS; BFF propagates EMPLOYEE_IS_SEPARATED code.
// Reference: spec/07_security_architecture.md — SEC-003 JWT transport
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-005, GD-M12-1, EMP-302

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import type { ChangeEmployeeStatusBffResponse } from '@/features/workforce/types';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies ChangeEmployeeStatusBffResponse,
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies ChangeEmployeeStatusBffResponse,
      { status: 400 },
    );
  }

  const base = process.env.API_URL ?? 'http://localhost:3001';

  let apiRes: Response;
  try {
    apiRes = await fetch(`${base}/api/v1/employees/${id}/status`, {
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
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies ChangeEmployeeStatusBffResponse,
      { status: 503 },
    );
  }

  if (apiRes.ok) {
    const data = (await apiRes.json()) as ChangeEmployeeStatusBffResponse;
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
    { success: false, error: { code: errorCode, message: 'Request failed' } } satisfies ChangeEmployeeStatusBffResponse,
    { status: apiRes.status },
  );
}
