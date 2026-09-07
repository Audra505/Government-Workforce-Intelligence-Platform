// Audit event list page — Server Component.
// Fetches GET /api/v1/audit-events with JWT from session cookie.
// Server-side access check mirrors admin/users/page.tsx (GD-M39-1 Decision
// 20) — navigation visibility is never the authorization boundary; the API
// itself (audit:read, RolesGuard) remains authoritative.
// Reference: governance/GD-M39-1.md — Decision 16, 17, 20

import { cookies } from 'next/headers';
import { serverFetch } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { SESSION_COOKIE } from '@/lib/auth';
import { OversightShell, getOversightAccess } from '@/features/oversight/components/oversight-shell';
import { AuditEventTable } from '@/features/oversight/components/audit-event-table';
import { AuditFilters } from '@/features/oversight/components/audit-filters';
import { AuditRecoveryPanel } from '@/features/oversight/components/audit-recovery-panel';
import type {
  AuditEventListApiResponse,
  RecoveryStatusApiResponse,
} from '@/features/oversight/types';

type PageSearchParams = { [key: string]: string | string[] | undefined };
type Props = { searchParams: PageSearchParams };

function getString(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

export default async function OversightAuditPage({ searchParams }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const { canRead, canRecover } = getOversightAccess(roles);

  if (!canRead) {
    return (
      <OversightShell breadcrumb="Audit">
        <div className="flex min-h-[300px] items-center justify-center">
          <p className="text-sm" style={{ color: '#dc2626' }}>
            You do not have permission to view this page.
          </p>
        </div>
      </OversightShell>
    );
  }

  const search = getString(searchParams.search);
  const result = getString(searchParams.result);
  const cursor = getString(searchParams.cursor);

  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (result) params.set('result', result);
  if (cursor) params.set('cursor', cursor);
  params.set('pageSize', '25');

  const [listResponse, recoveryResponse] = await Promise.all([
    serverFetch<AuditEventListApiResponse>(`/api/v1/audit-events?${params.toString()}`),
    serverFetch<RecoveryStatusApiResponse>('/api/v1/audit-events/recovery-status'),
  ]);

  const { events, nextCursor } = listResponse.data;

  return (
    <OversightShell breadcrumb="Audit">
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: '#0f172a' }}>Audit Log</h2>
        <p className="mt-1 text-sm" style={{ color: '#475569' }}>
          Tenant-scoped audit trail, failed-write recovery, and tamper-evidence chain health.
        </p>
      </div>

      <AuditRecoveryPanel summary={recoveryResponse.data} canRecover={canRecover} />

      <AuditFilters initialSearch={search} initialResult={result} />

      <AuditEventTable events={events} />

      {nextCursor && (
        <div className="mt-4 flex justify-end">
          <a
            href={`/oversight/audit?${new URLSearchParams({
              ...(search ? { search } : {}),
              ...(result ? { result } : {}),
              cursor: nextCursor,
            }).toString()}`}
            className="rounded-md border px-3 py-1.5 text-sm font-medium"
            style={{ borderColor: '#e2e8f0', color: '#0f172a' }}
          >
            Next page →
          </a>
        </div>
      )}
    </OversightShell>
  );
}
