// BFF POST handler — proxies POST /api/positions/:id/close → NestJS POST /api/v1/positions/:id/close.
// Terminal transition; subject to POS-500 guards (HAS_ACTIVE_VACANCIES, HAS_ACTIVE_INCUMBENT).
// Reads JWT from httpOnly session cookie — browser never handles the token directly.
// Reference: spec/07_security_architecture.md — SEC-003 JWT transport
// Reference: directives/02_position_management_rules.md — POS-500, POS-501, POS-AUTH-005
// Reference: governance/GD-M15-1.md — Decision 5 (HAS_ACTIVE_INCUMBENT guard)
// Reference: governance/GD-PHASE2-CLOSURE-002.md — Decision 3 (UI must surface both close errors)

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import type { ClosePositionBffResponse } from '@/features/workforce/types';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies ClosePositionBffResponse,
      { status: 401 },
    );
  }

  const base = process.env.API_URL ?? 'http://localhost:3001';

  let apiRes: Response;
  try {
    apiRes = await fetch(`${base}/api/v1/positions/${id}/close`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies ClosePositionBffResponse,
      { status: 503 },
    );
  }

  if (apiRes.ok) {
    const data = (await apiRes.json()) as ClosePositionBffResponse;
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
    { success: false, error: { code: errorCode, message: 'Request failed' } } satisfies ClosePositionBffResponse,
    { status: apiRes.status },
  );
}
