// BFF POST handler — archive candidate.
// Browser endpoint: POST /api/recruiting/candidates/:id
// Backend target:   POST /api/v1/candidates/:id/archive  (204, no request body)
//
// Note: GD-M20-1 D3 describes this as "PATCH /api/v1/candidates/:id (archive)" but
// the actual backend endpoint is POST /candidates/:id/archive with no body and a 204
// response. The governance shorthand is inaccurate; this implementation uses the
// correct backend endpoint confirmed in candidate.controller.ts.
//
// No request body is read or forwarded — the archive endpoint has no body in NestJS.
// A 204 from NestJS is converted to { success: true } for the browser.
//
// SEC-003: no tenantId is accepted from or forwarded by this handler.
//
// Reference: governance/GD-M20-1.md — Decision 3, 6
// Reference: apps/api/src/recruiting/candidate.controller.ts — POST /candidates/:id/archive (line 267)

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

type BffResponse =
  | { success: true }
  | { success: false; error: { code: string; message: string } };

type BffErrorResponse = { success: false; error: { code: string; message: string } };

// Fields allowed in candidate update body — tenantId and status are never forwarded (SEC-003)
const EDIT_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'source', 'notes'] as const;
type EditField = (typeof EDIT_FIELDS)[number];

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies BffResponse,
      { status: 401 },
    );
  }

  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

  let nestRes: Response;
  try {
    nestRes = await fetch(`${apiUrl}/api/v1/candidates/${id}/archive`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies BffResponse,
      { status: 503 },
    );
  }

  // NestJS returns 204 (no body) on success — convert to structured { success: true }.
  if (nestRes.ok) {
    return Response.json({ success: true } satisfies BffResponse, { status: 200 });
  }

  let nestError: { error?: { code?: string; message?: string } } = {};
  try {
    nestError = (await nestRes.json()) as typeof nestError;
  } catch {
    // body parse failed — fall through to generic error
  }

  return Response.json(
    {
      success: false,
      error: {
        code: nestError.error?.code ?? 'INTERNAL_ERROR',
        message: nestError.error?.message ?? 'An unexpected error occurred',
      },
    } satisfies BffResponse,
    { status: nestRes.status },
  );
}

// ─── PUT /api/recruiting/candidates/:id — update candidate fields ─────────────
// Browser endpoint: PUT /api/recruiting/candidates/:id
// Backend target:   PUT /api/v1/candidates/:id  (200 + updated CandidateShape)
//
// SEC-003: only firstName, lastName, email, phone, source, notes are forwarded.
// tenantId and status are never accepted from or forwarded by this handler.
//
// Reference: governance/GD-M20-1.md — Decision 3, 6
// Reference: apps/api/src/recruiting/candidate.controller.ts — PUT /candidates/:id (line 206)

export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies BffErrorResponse,
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies BffErrorResponse,
      { status: 400 },
    );
  }

  // SEC-003: explicitly reject any request body that contains tenantId
  if ('tenantId' in body) {
    return Response.json(
      { success: false, error: { code: 'FORBIDDEN_FIELD', message: 'tenantId is not permitted in this request' } } satisfies BffErrorResponse,
      { status: 400 },
    );
  }

  // Extract only allowed fields — status is never forwarded
  const allowed: Partial<Record<EditField, string>> = {};
  for (const field of EDIT_FIELDS) {
    const value = body[field];
    if (typeof value === 'string') {
      allowed[field] = value;
    }
  }

  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

  let nestRes: Response;
  try {
    nestRes = await fetch(`${apiUrl}/api/v1/candidates/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(allowed),
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies BffErrorResponse,
      { status: 503 },
    );
  }

  if (nestRes.ok) {
    // NestJS returns 200 + { success: true, data: CandidateShape } — forward as-is
    const nestData: unknown = await nestRes.json();
    return Response.json(nestData);
  }

  let nestError: { error?: { code?: string; message?: string } } = {};
  try {
    nestError = (await nestRes.json()) as typeof nestError;
  } catch {
    // body parse failed — fall through to generic error
  }

  return Response.json(
    {
      success: false,
      error: {
        code: nestError.error?.code ?? 'INTERNAL_ERROR',
        message: nestError.error?.message ?? 'An unexpected error occurred',
      },
    } satisfies BffErrorResponse,
    { status: nestRes.status },
  );
}
