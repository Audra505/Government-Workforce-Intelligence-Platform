// Certification catalog list table — Server Component.
// Passed certifications array already fetched by the page; no data fetching here.
// Edit link shown only when canWrite is true (GD-M24-1 D3).
// No detail page exists in M24 — name is not a link.
// expirationRequired displayed as "Required" / "Not required" pill-style badge.
// Reference: governance/GD-M24-1.md — Decisions 1, 3

import Link from 'next/link';
import type { CertificationRow } from '@/features/workforce/types';
import { EmptyState } from '@/components/shared/empty-state';

const TH_STYLE = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.09em',
  color: '#94a3b8',
  backgroundColor: '#f8fafc',
  whiteSpace: 'nowrap',
} as const;

type Props = {
  certifications: CertificationRow[];
  canWrite: boolean;
};

function ExpirationBadge({ required }: { required: boolean }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={
        required
          ? { backgroundColor: '#dcfce7', color: '#15803d' }
          : { backgroundColor: '#f1f5f9', color: '#64748b' }
      }
    >
      {required ? 'Required' : 'Not required'}
    </span>
  );
}

export function CertificationTable({ certifications, canWrite }: Props) {
  if (certifications.length === 0) {
    return <EmptyState message="No certifications defined in the catalog yet." />;
  }

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: '#e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Name</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Issuer</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Expiration</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Created</th>
              {canWrite && (
                <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {certifications.map((c) => (
              <tr
                key={c.id}
                className="h-12 border-b last:border-0 transition-colors hover:bg-slate-50"
                style={{ borderColor: '#e2e8f0' }}
              >
                <td className="px-4 py-3 font-medium" style={{ color: '#0f172a' }}>
                  {c.name}
                </td>
                <td className="px-4 py-3" style={{ color: '#475569' }}>
                  {c.issuer ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <ExpirationBadge required={c.expirationRequired} />
                </td>
                <td className="whitespace-nowrap px-4 py-3" style={{ color: '#475569' }}>
                  {new Date(c.createdAt).toLocaleDateString()}
                </td>
                {canWrite && (
                  <td className="px-4 py-3">
                    <Link
                      href={`/workforce/certifications/${c.id}/edit`}
                      className="text-sm hover:underline"
                      style={{ color: '#2563eb' }}
                    >
                      Edit
                    </Link>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
