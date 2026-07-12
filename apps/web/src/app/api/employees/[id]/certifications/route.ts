// BFF Route Handler — Employee Certification Assignments.
// GET:  Browser endpoint  GET /api/employees/:id/certifications
//       Backend target:   GET /api/v1/employees/:id/certifications
//       Returns the complete (non-paginated) set of certification assignments for one employee.
//       Used by client components that need live data after a POST.
//       Server components use serverFetch directly.
// POST: Browser endpoint  POST /api/employees/:id/certifications
//       Backend target:   POST /api/v1/employees/:id/certifications
//       Upsert — 201 on first assignment (INSERT), 200 on update (UPDATE).
//       Body: { certificationId: UUID, status?: string, issueDate?: string,
//               expirationDate?: string }
//       INSERT rules (GD-M13-3, CRT-207): status must be ACTIVE or absent.
//       REVOKED is terminal — no outbound transitions (CRT-301).
//       expirationDate required when certification.expirationRequired = true.
//       EMP-302: SEPARATED employees rejected with EMPLOYEE_SEPARATED.
//       Response shape: { success: true, data: { assignment: { certificationId,
//                         certificationName, issuer, status, issueDate,
//                         expirationDate } } }
//       Note: response is nested in { assignment: ... } — not transformed here.
//
// SEC-003: tenantId derived from JWT — never accepted from client.
//   GET  — no request body; cross-tenant employee returns 404 from NestJS.
//   POST — tenantId in body rejected with 400 before forwarding.
//
// Reference: governance/GD-M24-1.md — Decisions 3, 6, 7, 8
// Reference: governance/GD-M13-2.md — D15 (HTTP status), D16 (response contract)
// Reference: governance/GD-M13-3.md — certification status enumeration
// Reference: apps/api/src/workforce/employee.controller.ts — certifications section

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

type BffError = { success: false; error: { code: string; message: string } };

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies BffError,
      { status: 401 },
    );
  }

  const base = process.env.API_URL ?? 'http://localhost:3001';

  let apiRes: Response;
  try {
    apiRes = await fetch(`${base}/api/v1/employees/${id}/certifications`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies BffError,
      { status: 503 },
    );
  }

  if (apiRes.ok) {
    const data: unknown = await apiRes.json();
    return Response.json(data);
  }

  let nestError: { error?: { code?: string; message?: string } } = {};
  try {
    nestError = (await apiRes.json()) as typeof nestError;
  } catch {
    // fall through
  }

  return Response.json(
    {
      success: false,
      error: {
        code: nestError.error?.code ?? 'INTERNAL_ERROR',
        message: nestError.error?.message ?? 'An unexpected error occurred',
      },
    } satisfies BffError,
    { status: apiRes.status },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies BffError,
      { status: 400 },
    );
  }

  // SEC-003: reject any request body that carries tenantId.
  if ('tenantId' in body) {
    return Response.json(
      { success: false, error: { code: 'FORBIDDEN_FIELD', message: 'tenantId is not permitted in this request' } } satisfies BffError,
      { status: 400 },
    );
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies BffError,
      { status: 401 },
    );
  }

  const base = process.env.API_URL ?? 'http://localhost:3001';

  let apiRes: Response;
  try {
    apiRes = await fetch(`${base}/api/v1/employees/${id}/certifications`, {
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
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies BffError,
      { status: 503 },
    );
  }

  if (apiRes.ok) {
    const data: unknown = await apiRes.json();
    // GD-M13-2 D15: backend returns 201 on INSERT, 200 on UPDATE — forward as-is.
    // Response is nested as { success: true, data: { assignment: { ... } } } — not transformed.
    return Response.json(data, { status: apiRes.status });
  }

  let nestError: { error?: { code?: string; message?: string } } = {};
  try {
    nestError = (await apiRes.json()) as typeof nestError;
  } catch {
    // fall through
  }

  return Response.json(
    {
      success: false,
      error: {
        code: nestError.error?.code ?? 'INTERNAL_ERROR',
        message: nestError.error?.message ?? 'An unexpected error occurred',
      },
    } satisfies BffError,
    { status: apiRes.status },
  );
}
