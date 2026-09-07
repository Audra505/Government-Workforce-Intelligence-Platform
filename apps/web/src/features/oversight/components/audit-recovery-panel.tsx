'use client';

// Sanitized recovery-status and chain-health summary panel. Requeue and
// re-verification controls are visible and operable only for System
// Administrator — Compliance Officer sees the same summaries with no
// mutation controls of any kind (GD-M39-1 Decision 20).
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RecoveryStatusSummary } from '@/features/oversight/types';

const BORDER = '#e2e8f0';
const TEXT = '#0f172a';
const SUB = '#475569';

function ChainBadge({ status }: { status: RecoveryStatusSummary['chain']['status'] }) {
  const style =
    status === 'OK'
      ? { backgroundColor: '#dcfce7', color: '#16a34a' }
      : status === 'BROKEN'
        ? { backgroundColor: '#fee2e2', color: '#dc2626' }
        : { backgroundColor: '#f1f5f9', color: SUB };
  return (
    <span className="rounded px-2 py-0.5 text-xs font-medium" style={style}>
      {status}
    </span>
  );
}

export function AuditRecoveryPanel({
  summary,
  canRecover,
}: {
  summary: RecoveryStatusSummary;
  canRecover: boolean;
}) {
  const router = useRouter();
  const [pendingRequeueId, setPendingRequeueId] = useState<string | null>(null);
  const [isReverifying, setIsReverifying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleRequeue(id: string) {
    setPendingRequeueId(id);
    setMessage(null);
    try {
      const res = await fetch(`/api/audit-events/recovery/${id}/requeue`, { method: 'POST' });
      if (res.ok) {
        setMessage('Requeued for another recovery attempt.');
        router.refresh();
      } else {
        const data = (await res.json()) as { error?: { message?: string } };
        setMessage(data.error?.message ?? 'Requeue failed.');
      }
    } catch {
      setMessage('Unable to reach the server.');
    } finally {
      setPendingRequeueId(null);
    }
  }

  async function handleReverify() {
    setIsReverifying(true);
    setMessage(null);
    try {
      const res = await fetch('/api/audit-events/integrity/reverify', { method: 'POST' });
      if (res.ok) {
        setMessage('Out-of-cycle re-verification scheduled.');
        router.refresh();
      } else {
        const data = (await res.json()) as { error?: { message?: string } };
        setMessage(data.error?.message ?? 'Re-verification request failed.');
      }
    } catch {
      setMessage('Unable to reach the server.');
    } finally {
      setIsReverifying(false);
    }
  }

  return (
    <div className="mb-6 rounded-md border p-4" style={{ borderColor: BORDER }}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: TEXT }}>Recovery &amp; Chain Health</h3>
        {canRecover && (
          <button
            onClick={handleReverify}
            disabled={isReverifying}
            className="rounded-md border px-3 py-1 text-xs font-medium"
            style={{ borderColor: BORDER, color: TEXT }}
          >
            {isReverifying ? 'Scheduling…' : 'Request out-of-cycle re-verification'}
          </button>
        )}
      </div>

      <div className="mb-4 flex items-center gap-6 text-sm" style={{ color: SUB }}>
        <span>Chain status: <ChainBadge status={summary.chain.status} /></span>
        <span>
          Last verified:{' '}
          {summary.chain.lastVerifiedAt ? new Date(summary.chain.lastVerifiedAt).toLocaleString() : 'never'}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-3 text-sm">
        <div><span style={{ color: SUB }}>Pending</span><div style={{ color: TEXT }}>{summary.counts.pending}</div></div>
        <div><span style={{ color: SUB }}>In progress</span><div style={{ color: TEXT }}>{summary.counts.inProgress}</div></div>
        <div><span style={{ color: SUB }}>Retried</span><div style={{ color: TEXT }}>{summary.counts.retried}</div></div>
        <div><span style={{ color: SUB }}>Abandoned</span><div style={{ color: TEXT }}>{summary.counts.abandoned}</div></div>
      </div>

      {message && (
        <p role="status" className="mb-3 text-xs" style={{ color: SUB }}>{message}</p>
      )}

      {summary.abandonedFailures.length > 0 && (
        <div className="overflow-x-auto rounded-md border" style={{ borderColor: BORDER }}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left" style={{ borderColor: BORDER, color: SUB }}>
                <th className="px-3 py-1.5 font-medium">Action</th>
                <th className="px-3 py-1.5 font-medium">Occurred At</th>
                <th className="px-3 py-1.5 font-medium">Attempts</th>
                <th className="px-3 py-1.5 font-medium">Failure Reason</th>
                {canRecover && <th className="px-3 py-1.5 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {summary.abandonedFailures.map((f) => (
                <tr key={f.id} className="border-b last:border-b-0" style={{ borderColor: BORDER }}>
                  <td className="px-3 py-1.5 font-mono" style={{ color: TEXT }}>{f.action}</td>
                  <td className="px-3 py-1.5" style={{ color: SUB }}>{new Date(f.occurredAt).toLocaleString()}</td>
                  <td className="px-3 py-1.5" style={{ color: SUB }}>{f.attemptCount}</td>
                  <td className="px-3 py-1.5" style={{ color: SUB }}>{f.failureReason}</td>
                  {canRecover && (
                    <td className="px-3 py-1.5 text-right">
                      <button
                        onClick={() => handleRequeue(f.id)}
                        disabled={pendingRequeueId === f.id}
                        className="rounded border px-2 py-0.5 text-xs font-medium"
                        style={{ borderColor: BORDER, color: '#2563eb' }}
                      >
                        {pendingRequeueId === f.id ? 'Requeuing…' : 'Requeue'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
