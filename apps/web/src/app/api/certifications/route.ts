// BFF Route Handler — Certifications Catalog collection.
// GET:  Browser endpoint  GET /api/certifications?page&pageSize
//       Backend target:   GET /api/v1/certifications
//       Returns paginated certification catalog for the current tenant.
//       Used by client components (assign forms) that cannot call serverFetch.
//       Note: GET /api/v1/certifications has no category filter (unlike skills).
// POST: Browser endpoint  POST /api/certifications
//       Backend target:   POST /api/v1/certifications
//       Creates a new certification in the tenant catalog. Returns 201 + created cert.
//
// SEC-003: tenantId is derived from JWT by NestJS — never accepted from the client.
//   GET  — NestJS ignores unknown query params; JWT scopes the result to tenant.
//   POST — tenantId in request body rejected with 400 before forwarding.
//
// Reference: governance/GD-M24-1.md — Decisions 3, 8
// Reference: apps/api/src/workforce/certification.controller.ts

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

type BffError = { success: false; error: { code: string; message: string } };

export async function GET(req: NextRequest): Promise<Response> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies BffError,
      { status: 401 },
    );
  }

  const base = process.env.API_URL ?? 'http://localhost:3001';
  const search = req.nextUrl.searchParams.toString();
  const url = search ? `${base}/api/v1/certifications?${search}` : `${base}/api/v1/certifications`;

  let apiRes: Response;
  try {
    apiRes = await fetch(url, {
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

export async function POST(req: NextRequest): Promise<Response> {
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
    apiRes = await fetch(`${base}/api/v1/certifications`, {
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
    return Response.json(data, { status: 201 });
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
