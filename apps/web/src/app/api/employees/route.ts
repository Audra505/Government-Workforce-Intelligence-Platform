// BFF employee Route Handler — proxies POST /api/employees → NestJS POST /api/v1/employees.
// Reads JWT from httpOnly session cookie; browser never contacts NestJS directly.
// tenantId is never in the request body — NestJS derives it from the JWT (SEC-003).
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation, BFF pattern
// Reference: apps/api/src/workforce/employee.controller.ts — POST /api/v1/employees
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-001

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import type { CreateEmployeeBffResponse } from '@/features/workforce/types';

export async function POST(req: NextRequest): Promise<Response> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies CreateEmployeeBffResponse,
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies CreateEmployeeBffResponse,
      { status: 400 },
    );
  }

  const base = process.env.API_URL ?? 'http://localhost:3001';

  let apiRes: Response;
  try {
    apiRes = await fetch(`${base}/api/v1/employees`, {
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
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies CreateEmployeeBffResponse,
      { status: 503 },
    );
  }

  if (apiRes.ok) {
    const data = (await apiRes.json()) as CreateEmployeeBffResponse;
    return Response.json(data, { status: 201 });
  }

  let errorCode = 'INTERNAL_ERROR';
  try {
    const errBody = (await apiRes.json()) as { success: false; error?: { code: string } };
    if (errBody.error?.code) errorCode = errBody.error.code;
  } catch {
    // Use default errorCode
  }

  return Response.json(
    { success: false, error: { code: errorCode, message: 'Request failed' } } satisfies CreateEmployeeBffResponse,
    { status: apiRes.status },
  );
}
