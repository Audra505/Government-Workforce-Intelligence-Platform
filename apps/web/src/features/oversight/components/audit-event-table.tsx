// Audit event list table. Server Component — no interactivity of its own.
// occurredAt is the primary displayed time; a "recorded late" indicator
// shows when createdAt materially differs (GD-M39-1 Decision 5/20).
import Link from 'next/link';
import type { AuditEventSummary } from '@/features/oversight/types';

const BORDER = '#e2e8f0';
const TEXT = '#0f172a';
const SUB = '#475569';
const AMBER = '#b45309';

export function AuditEventTable({ events }: { events: AuditEventSummary[] }) {
  if (events.length === 0) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-md border" style={{ borderColor: BORDER }}>
        <p className="text-sm" style={{ color: SUB }}>No audit events match these filters.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border" style={{ borderColor: BORDER }}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left" style={{ borderColor: BORDER, color: SUB }}>
            <th className="px-4 py-2 font-medium">Occurred At</th>
            <th className="px-4 py-2 font-medium">Action</th>
            <th className="px-4 py-2 font-medium">Result</th>
            <th className="px-4 py-2 font-medium">Actor</th>
            <th className="px-4 py-2 font-medium">Entity</th>
            <th className="px-4 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-b last:border-b-0" style={{ borderColor: BORDER }}>
              <td className="px-4 py-2" style={{ color: TEXT }}>
                {new Date(event.occurredAt).toLocaleString()}
                {event.recordedLate && (
                  <span
                    className="ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium"
                    style={{ backgroundColor: '#fef3c7', color: AMBER }}
                    title={`Recorded at ${new Date(event.createdAt).toLocaleString()}`}
                  >
                    recorded late
                  </span>
                )}
              </td>
              <td className="px-4 py-2 font-mono text-xs" style={{ color: TEXT }}>{event.action}</td>
              <td className="px-4 py-2" style={{ color: event.result === 'SUCCESS' ? '#16a34a' : '#dc2626' }}>
                {event.result}
              </td>
              <td className="px-4 py-2" style={{ color: SUB }}>
                {event.actorDisplayName ?? event.actorUserId}
              </td>
              <td className="px-4 py-2" style={{ color: SUB }}>
                {event.entityType ? `${event.entityType}${event.entityId ? ` (${event.entityId.slice(0, 8)}…)` : ''}` : '—'}
              </td>
              <td className="px-4 py-2 text-right">
                <Link href={`/oversight/audit/${event.id}`} className="text-xs font-medium" style={{ color: '#2563eb' }}>
                  Detail
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
