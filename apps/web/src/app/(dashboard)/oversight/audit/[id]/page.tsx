// Audit event detail page — Server Component.
// Fetches GET /api/v1/audit-events/:id with JWT from session cookie.
// Reference: governance/GD-M39-1.md — Decision 16, 17, 20

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverFetch, ApiError } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { SESSION_COOKIE } from '@/lib/auth';
import { OversightShell, getOversightAccess } from '@/features/oversight/components/oversight-shell';
import type { AuditEventDetailApiResponse } from '@/features/oversight/types';

const BORDER = '#e2e8f0';
const TEXT = '#0f172a';
const SUB = '#475569';

type Props = { params: { id: string } };

export default async function OversightAuditDetailPage({ params }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const { canRead } = getOversightAccess(roles);

  if (!canRead) {
    return (
      <OversightShell breadcrumb="Audit Detail">
        <div className="flex min-h-[300px] items-center justify-center">
          <p className="text-sm" style={{ color: '#dc2626' }}>
            You do not have permission to view this page.
          </p>
        </div>
      </OversightShell>
    );
  }

  let response: AuditEventDetailApiResponse;
  try {
    response = await serverFetch<AuditEventDetailApiResponse>(`/api/v1/audit-events/${params.id}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const event = response.data;

  return (
    <OversightShell breadcrumb="Audit Detail">
      <div className="mb-6">
        <h2 className="text-2xl font-bold tracking-tight" style={{ color: TEXT }}>Audit Event</h2>
        <p className="mt-1 font-mono text-xs" style={{ color: SUB }}>{event.id}</p>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-md border p-4 text-sm" style={{ borderColor: BORDER }}>
        <div>
          <dt className="font-medium" style={{ color: SUB }}>Occurred At</dt>
          <dd style={{ color: TEXT }}>
            {new Date(event.occurredAt).toLocaleString()}
            {event.recordedLate && (
              <span
                className="ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium"
                style={{ backgroundColor: '#fef3c7', color: '#b45309' }}
              >
                recorded late — durable at {new Date(event.createdAt).toLocaleString()}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium" style={{ color: SUB }}>Recorded At</dt>
          <dd style={{ color: TEXT }}>{new Date(event.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="font-medium" style={{ color: SUB }}>Action</dt>
          <dd className="font-mono" style={{ color: TEXT }}>{event.action}</dd>
        </div>
        <div>
          <dt className="font-medium" style={{ color: SUB }}>Result</dt>
          <dd style={{ color: event.result === 'SUCCESS' ? '#16a34a' : '#dc2626' }}>{event.result}</dd>
        </div>
        <div>
          <dt className="font-medium" style={{ color: SUB }}>Actor</dt>
          <dd style={{ color: TEXT }}>{event.actorDisplayName ?? event.actorUserId}</dd>
        </div>
        <div>
          <dt className="font-medium" style={{ color: SUB }}>Entity</dt>
          <dd style={{ color: TEXT }}>
            {event.entityType ? `${event.entityType}${event.entityId ? ` / ${event.entityId}` : ''}` : '—'}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="font-medium" style={{ color: SUB }}>Metadata</dt>
          <dd className="mt-1 rounded bg-slate-50 p-3 font-mono text-xs" style={{ color: TEXT }}>
            {event.metadata ? JSON.stringify(event.metadata, null, 2) : '— none exposed for this event type —'}
          </dd>
        </div>
      </dl>
    </OversightShell>
  );
}
