// BFF PATCH handler — proxies PATCH /api/users/[id] → NestJS PATCH /api/v1/users/:id.
// JWT read from httpOnly session cookie; browser never contacts NestJS directly.
// SEC-003: tenantId must NEVER be forwarded; rejected with 400 if present in body.
// Reference: governance/GD-M27-1.md — Decision 9

import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import type { UpdateUserBffResponse } from '@/features/admin/types';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies UpdateUserBffResponse,
      { status: 400 },
    );
  }

  // SEC-003: reject if client attempted to forward tenantId
  if ('tenantId' in body) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'tenantId is not accepted' } } satisfies UpdateUserBffResponse,
      { status: 400 },
    );
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies UpdateUserBffResponse,
      { status: 401 },
    );
  }

  const { id } = params;
  if (!id) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'User ID is required' } } satisfies UpdateUserBffResponse,
      { status: 400 },
    );
  }

  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

  let nestRes: Response;
  try {
    nestRes = await fetch(`${apiUrl}/api/v1/users/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Unable to reach the server' } } satisfies UpdateUserBffResponse,
      { status: 503 },
    );
  }

  if (nestRes.ok) {
    const data = (await nestRes.json()) as UpdateUserBffResponse;
    return NextResponse.json(data, { status: 200 });
  }

  let nestError: { error?: { code?: string; message?: string } } = {};
  try {
    nestError = (await nestRes.json()) as typeof nestError;
  } catch {
    // fall through — nestError stays as empty object
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: nestError.error?.code ?? 'INTERNAL_ERROR',
        message: nestError.error?.message ?? 'An unexpected error occurred',
      },
    } satisfies UpdateUserBffResponse,
    { status: nestRes.status },
  );
}
