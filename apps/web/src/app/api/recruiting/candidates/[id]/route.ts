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
