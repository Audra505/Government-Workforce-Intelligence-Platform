// BFF POST handler — mark interview as NO_SHOW.
// Browser endpoint: POST /api/recruiting/interviews/:id/no-show
// Backend target:   POST /api/v1/interviews/:id/no-show  (200, returns updated interview)
//
// No request body — NestJS no-show endpoint takes no body.
// Terminal action: sets interview status to NO_SHOW; cannot be undone.
//
// SEC-003: no tenantId is accepted from or forwarded by this handler.
//
// Reference: governance/GD-M20-1.md — Decision 3, 7 (Interviews)
// Reference: apps/api/src/recruiting/interview.controller.ts — POST /interviews/:id/no-show (line 456)

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
    nestRes = await fetch(`${apiUrl}/api/v1/interviews/${id}/no-show`, {
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
        code:    nestError.error?.code    ?? 'INTERNAL_ERROR',
        message: nestError.error?.message ?? 'An unexpected error occurred',
      },
    } satisfies BffResponse,
    { status: nestRes.status },
  );
}
