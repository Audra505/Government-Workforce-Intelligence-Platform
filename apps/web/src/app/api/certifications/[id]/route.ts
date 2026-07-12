// BFF Route Handler — Certifications Catalog item.
// GET:  Browser endpoint  GET /api/certifications/:id
//       Backend target:   GET /api/v1/certifications/:id
//       Returns a single certification by ID. Intended for edit page pre-population
//       when a client component needs the detail (server components use serverFetch).
// PATCH: Browser endpoint  PATCH /api/certifications/:id
//        Backend target:   PATCH /api/v1/certifications/:id
//        Partial update — name, issuer, expirationRequired (all optional).
//        409 CERTIFICATION_NAME_CONFLICT forwarded if duplicate name within tenant.
//        Note: toggling expirationRequired affects future assignment enforcement.
//
// SEC-003: tenantId derived from JWT — never accepted from client.
//   GET   — no request body; NestJS scopes by JWT.
//   PATCH — tenantId in body rejected with 400 before forwarding.
//
// Reference: governance/GD-M24-1.md — Decisions 3, 8
// Reference: apps/api/src/workforce/certification.controller.ts

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
    apiRes = await fetch(`${base}/api/v1/certifications/${id}`, {
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

export async function PATCH(
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
    apiRes = await fetch(`${base}/api/v1/certifications/${id}`, {
      method: 'PATCH',
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
    return Response.json(data, { status: 200 });
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
