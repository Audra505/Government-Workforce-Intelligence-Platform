// BFF POST handler — initiate hire for an application.
// Browser endpoint: POST /api/recruiting/applications/:id/hire
// Backend target:   POST /api/v1/applications/:id/hire  (201, creates employee record)
//
// No request body — NestJS hire endpoint takes no body (GD-M19-1 D6).
// Authorization: System Administrator and HR Director only; Recruiter excluded (GD-M20-1 D5, D7).
// UX gate (not rendering the Hire button for Recruiter/CO/others) is enforced in the Server Component.
// The API enforces authorization independently and returns 403 for unauthorized callers.
//
// SEC-003: no tenantId is accepted from or forwarded by this handler.
//
// Reference: governance/GD-M20-1.md — Decision 3, 5, 7 (Applications/Hire)
// Reference: apps/api/src/recruiting/hire.controller.ts — POST /applications/:id/hire (line 55)
// Reference: governance/GD-M19-1.md — Decision 3 (SA+HRD only), 6 (no request body)

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
    nestRes = await fetch(`${apiUrl}/api/v1/applications/${id}/hire`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies BffResponse,
      { status: 503 },
    );
  }

  if (nestRes.ok) {
    return Response.json({ success: true } satisfies BffResponse, { status: 201 });
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
        code:    nestError.error?.code    ?? 'INTERNAL_ERROR',
        message: nestError.error?.message ?? 'An unexpected error occurred',
      },
    } satisfies BffResponse,
    { status: nestRes.status },
  );
}
