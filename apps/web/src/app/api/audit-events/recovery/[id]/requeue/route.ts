// BFF POST handler — proxies POST /api/audit-events/recovery/:id/requeue →
// NestJS POST /api/v1/audit-events/recovery/:id/requeue.
// Reads JWT from httpOnly session cookie — browser never handles the token
// directly. No request body is accepted or forwarded (GD-M39-1 Decision 16
// — requeue accepts no replacement event payload).
// Reference: spec/07_security_architecture.md — SEC-003 JWT transport
// Reference: governance/GD-M39-1.md — Decision 16, Decision 20

import type { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import type { AuditMutationBffResponse } from '@/features/oversight/types';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<Response> {
  const { id } = params;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return Response.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies AuditMutationBffResponse,
      { status: 401 },
    );
  }

  const base = process.env.API_URL ?? 'http://localhost:3001';

  let apiRes: Response;
  try {
    apiRes = await fetch(`${base}/api/v1/audit-events/recovery/${id}/requeue`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies AuditMutationBffResponse,
      { status: 503 },
    );
  }

  const data = (await apiRes.json()) as AuditMutationBffResponse;
  return Response.json(data, { status: apiRes.status });
}
