// BFF PATCH handler — proxies PATCH /api/departments/:id → NestJS PATCH /api/v1/departments/:id.
// JWT read from httpOnly session cookie; browser never contacts NestJS directly.
// SEC-003: tenantId must NEVER be forwarded; rejected with 400 if present in body.
// DEP-004: status='ACTIVE' is rejected — reactivation not supported in Phase 1 (GD-M25-1 D7).
// 422 guard errors from NestJS are forwarded unchanged for the client to display as banners (GD-M25-1 D8).
// Reference: governance/GD-M25-1.md — Decisions 7, 8

import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';
import type { UpdateDepartmentBffResponse } from '@/features/admin/types';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies UpdateDepartmentBffResponse,
      { status: 400 },
    );
  }

  // SEC-003: reject forwarded tenantId
  if ('tenantId' in body) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'tenantId is not accepted' } } satisfies UpdateDepartmentBffResponse,
      { status: 400 },
    );
  }

  // DEP-004: reactivation not supported in Phase 1
  if (body.status === 'ACTIVE') {
    return NextResponse.json(
      { success: false, error: { code: 'REACTIVATION_NOT_SUPPORTED', message: 'Department reactivation is not supported in this release.' } } satisfies UpdateDepartmentBffResponse,
      { status: 400 },
    );
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies UpdateDepartmentBffResponse,
      { status: 401 },
    );
  }

  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

  let nestRes: Response;
  try {
    nestRes = await fetch(`${apiUrl}/api/v1/departments/${params.id}`, {
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
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies UpdateDepartmentBffResponse,
      { status: 503 },
    );
  }

  if (nestRes.ok) {
    const data = (await nestRes.json()) as UpdateDepartmentBffResponse;
    return NextResponse.json(data, { status: 200 });
  }

  let nestError: { error?: { code?: string; message?: string } } = {};
  try {
    nestError = (await nestRes.json()) as typeof nestError;
  } catch {
    // fall through
  }

  // 422 guard errors forwarded unchanged so client can render persistent banners
  return NextResponse.json(
    {
      success: false,
      error: {
        code: nestError.error?.code ?? 'INTERNAL_ERROR',
        message: nestError.error?.message ?? 'An unexpected error occurred',
      },
    } satisfies UpdateDepartmentBffResponse,
    { status: nestRes.status },
  );
}
