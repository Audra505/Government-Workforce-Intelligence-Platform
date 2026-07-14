'use client';

// Deactivate Department action — Client Component.
// PATCH /api/departments/:id { status: 'INACTIVE' }.
// 422 guard errors displayed as persistent inline banners (GD-M25-1 D8).
// DEP-004: BFF rejects status='ACTIVE'; this component never sends it.
// No reactivation action (GD-M25-1 D2).
// Reference: governance/GD-M25-1.md — Decisions 2, 7, 8, 12

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UpdateDepartmentBffResponse } from '@/features/admin/types';


type Props = { departmentId: string; departmentName: string };

export function DeactivateDepartment({ departmentId, departmentName }: Props) {
  const router = useRouter();
  const [confirming, setConfirming]   = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [guardError, setGuardError]   = useState<string | null>(null);

  async function handleDeactivate() {
    setSubmitting(true);
    setGuardError(null);

    let res: Response;
    try {
      res = await fetch(`/api/departments/${departmentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'INACTIVE' }),
      });
    } catch {
      setGuardError('Unable to reach the server. Please try again.');
      setSubmitting(false);
      setConfirming(false);
      return;
    }

    const json = (await res.json()) as UpdateDepartmentBffResponse;
    setSubmitting(false);

    if (json.success) {
      router.refresh();
    } else if (res.status === 422) {
      // D8: use NestJS error.message directly — it includes position/employee counts
      setConfirming(false);
      setGuardError(json.error.message);
    } else {
      setConfirming(false);
      setGuardError(json.error.message);
    }
  }

  return (
    <div className="mt-8 rounded-lg border p-5" style={{ borderColor: '#fca5a5', backgroundColor: '#fef2f2' }}>
      <h3 className="text-sm font-semibold" style={{ color: '#991b1b' }}>
        Deactivate Department
      </h3>
      <p className="mt-1 text-sm" style={{ color: '#b91c1c' }}>
        Deactivating <strong>{departmentName}</strong> will prevent it from accepting new employees or positions.
        This action cannot be undone automatically.
      </p>

      {/* Persistent guard error banner — stays after confirming resets (GD-M25-1 D8) */}
      {guardError && (
        <div
          className="mt-4 rounded-md border px-4 py-3 text-sm"
          style={{ borderColor: '#fca5a5', backgroundColor: '#fff5f5', color: '#dc2626' }}
          role="alert"
        >
          {guardError}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        {!confirming ? (
          <button
            type="button"
            onClick={() => { setConfirming(true); setGuardError(null); }}
            className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-red-50"
            style={{ color: '#dc2626', borderColor: '#fca5a5' }}
          >
            Deactivate Department
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleDeactivate}
              disabled={submitting}
              className="rounded-md px-4 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-60"
              style={{ backgroundColor: '#dc2626' }}
            >
              {submitting ? 'Deactivating…' : 'Confirm Deactivate'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={submitting}
              className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-100"
              style={{ color: '#475569', borderColor: '#e2e8f0' }}
            >
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
