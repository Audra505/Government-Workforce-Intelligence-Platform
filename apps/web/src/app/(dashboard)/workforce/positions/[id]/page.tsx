// Position detail page — Server Component.
// Fetches GET /api/v1/positions/:id with JWT from session cookie.
// Response includes occupant field per GD-M15-1 D7.
// notFound() on 404 or 400 — position not found or invalid UUID (GD-11-1 pattern).
// canWrite from JWT roles — gates PositionActions (Activate, Freeze, Close).
// Reference: directives/02_position_management_rules.md — POS-AUTH-002, POS-AUTH-003
// Reference: governance/GD-M15-1.md — Decision 7 (occupant response contract)
// Reference: governance/GD-PHASE2-CLOSURE-002.md — Decision 3

import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { LogoutButton } from '@/features/auth/logout-button';
import { serverFetch, ApiError } from '@/lib/api';
import { PositionDetail } from '@/features/workforce/components/position-detail';
import { PositionActions } from '@/features/workforce/components/position-actions';
import { SESSION_COOKIE } from '@/lib/auth';
import type { PositionDetailApiResponse } from '@/features/workforce/types';

type Props = { params: { id: string } };

function getSessionRoles(token: string): string[] {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { roles?: unknown };
    return Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
  } catch {
    return [];
  }
}

export default async function PositionDetailPage({ params }: Props) {
  let response: PositionDetailApiResponse;

  try {
    response = await serverFetch<PositionDetailApiResponse>(`/api/v1/positions/${params.id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      notFound();
    }
    throw err;
  }

  const position = response.data;

  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite = roles.includes('System Administrator') || roles.includes('HR Director');

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">
            Government Workforce Intelligence Platform
          </h1>
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 p-6">
        <div className="mb-6">
          <Link
            href="/workforce/positions"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back to Positions
          </Link>
        </div>

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">{position.title}</h2>
            {position.classification && (
              <p className="mt-1 text-sm text-muted-foreground">{position.classification}</p>
            )}
          </div>
          <PositionActions id={position.id} status={position.status} canWrite={canWrite} />
        </div>

        <PositionDetail position={position} />
      </main>
    </div>
  );
}
