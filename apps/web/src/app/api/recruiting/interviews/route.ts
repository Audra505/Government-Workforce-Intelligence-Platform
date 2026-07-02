// BFF POST handler — schedule a new interview.
// Browser endpoint: POST /api/recruiting/interviews
// Backend target:   POST /api/v1/interviews  (201, returns interview record)
//
// Required body fields: applicationId, interviewType (PHONE_SCREEN|PANEL|TECHNICAL|FINAL)
// Optional body fields: scheduledAt (ISO 8601), interviewerName (max 255), interviewerUserId (UUID)
// BFF validates: at least one of interviewerName or interviewerUserId must be present
//   (mirrors INTERVIEWER_REQUIRED service-layer rule — GD-M18-1 D13)
//
// SEC-003: tenantId is never accepted from the browser body.
// Any request body containing tenantId is rejected with 400.
// tenantId is derived from the JWT by NestJS.
//
// Reference: governance/GD-M20-1.md — Decision 3, 6, 7 (Interviews)
// Reference: apps/api/src/recruiting/interview.controller.ts — POST /interviews (line 72)
// Reference: apps/api/src/recruiting/dto/create-interview.dto.ts

import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

type BffResponse =
  | { success: true }
  | { success: false; error: { code: string; message: string } };

const VALID_INTERVIEW_TYPES = new Set(['PHONE_SCREEN', 'PANEL', 'TECHNICAL', 'FINAL']);

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request body' } } satisfies BffResponse,
      { status: 400 },
    );
  }

  // SEC-003: reject any body that carries tenantId.
  if ('tenantId' in body) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'tenantId must not be supplied by the client' } } satisfies BffResponse,
      { status: 400 },
    );
  }

  if (!body.applicationId || typeof body.applicationId !== 'string') {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'applicationId is required' } } satisfies BffResponse,
      { status: 400 },
    );
  }

  if (!body.interviewType || !VALID_INTERVIEW_TYPES.has(body.interviewType as string)) {
    return NextResponse.json(
      { success: false, error: { code: 'VALIDATION_ERROR', message: 'interviewType must be PHONE_SCREEN, PANEL, TECHNICAL, or FINAL' } } satisfies BffResponse,
      { status: 400 },
    );
  }

  const hasInterviewerName   = typeof body.interviewerName   === 'string' && body.interviewerName.trim().length   > 0;
  const hasInterviewerUserId = typeof body.interviewerUserId === 'string' && body.interviewerUserId.trim().length > 0;
  if (!hasInterviewerName && !hasInterviewerUserId) {
    return NextResponse.json(
      { success: false, error: { code: 'INTERVIEWER_REQUIRED', message: 'At least one of interviewerName or interviewerUserId is required' } } satisfies BffResponse,
      { status: 400 },
    );
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json(
      { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } } satisfies BffResponse,
      { status: 401 },
    );
  }

  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

  let nestRes: Response;
  try {
    nestRes = await fetch(`${apiUrl}/api/v1/interviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: 'INTERNAL_ERROR', message: 'Service unavailable' } } satisfies BffResponse,
      { status: 503 },
    );
  }

  if (nestRes.ok) {
    return NextResponse.json({ success: true } satisfies BffResponse, { status: 201 });
  }

  let nestError: { error?: { code?: string; message?: string } } = {};
  try {
    nestError = (await nestRes.json()) as typeof nestError;
  } catch {
    // body parse failed — fall through to generic error
  }

  return NextResponse.json(
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
