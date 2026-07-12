// Expiring Certifications table — Server Component.
// Renders the list of employee certifications expiring within withinDays.
// Days Remaining column: past due shown in red; urgency encoded in pill color only.
// Employee name links to /workforce/employees/{employeeId}.
// Certification status pill: ACTIVE=green, EXPIRED=amber, REVOKED=red.
// Reference: governance/GD-M24-1.md — Decision 10

import Link from 'next/link';
import type { ExpiringCertItem, CertificationAssignmentStatus } from '@/features/workforce/types';
import { EmptyState } from '@/components/shared/empty-state';

const TH_STYLE = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.09em',
  color: '#94a3b8',
  backgroundColor: '#f8fafc',
  whiteSpace: 'nowrap',
} as const;

const CERT_STATUS_STYLE: Record<CertificationAssignmentStatus, { backgroundColor: string; color: string }> = {
  ACTIVE:  { backgroundColor: '#dcfce7', color: '#15803d' },
  EXPIRED: { backgroundColor: '#fef9c3', color: '#a16207' },
  REVOKED: { backgroundColor: '#fee2e2', color: '#dc2626' },
};

const CERT_STATUS_LABELS: Record<CertificationAssignmentStatus, string> = {
  ACTIVE:  'Active',
  EXPIRED: 'Expired',
  REVOKED: 'Revoked',
};

function daysUntil(iso: string): number {
  const exp = new Date(iso);
  exp.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((exp.getTime() - now.getTime()) / 86_400_000);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

function DaysRemainingPill({ days }: { days: number }) {
  let bg: string;
  let color: string;
  let label: string;

  if (days <= 0) {
    bg = '#fee2e2'; color = '#dc2626'; label = 'Past due';
  } else if (days <= 7) {
    bg = '#fee2e2'; color = '#dc2626'; label = `${days}d`;
  } else if (days <= 30) {
    bg = '#fef9c3'; color = '#a16207'; label = `${days}d`;
  } else {
    bg = '#f1f5f9'; color = '#475569'; label = `${days}d`;
  }

  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ backgroundColor: bg, color }}
    >
      {label}
    </span>
  );
}

type Props = {
  items: ExpiringCertItem[];
  withinDays: number;
};

export function ExpiringCertificationTable({ items, withinDays }: Props) {
  if (items.length === 0) {
    return (
      <EmptyState
        message={`No certifications expiring within ${withinDays} days.`}
      />
    );
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
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Employee</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Certification</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Status</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Issue Date</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Expiration Date</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Days Remaining</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const days = daysUntil(item.expirationDate);
              return (
                <tr
                  key={`${item.employeeId}-${item.certificationId}`}
                  className="h-12 border-b last:border-0 transition-colors hover:bg-slate-50"
                  style={{ borderColor: '#e2e8f0' }}
                >
                  {/* Employee */}
                  <td className="px-4 py-3">
                    <Link
                      href={`/workforce/employees/${item.employeeId}`}
                      className="font-medium hover:underline"
                      style={{ color: '#2563eb' }}
                    >
                      {item.firstName} {item.lastName}
                    </Link>
                    {item.employeeNumber && (
                      <p
                        className="mt-0.5 text-[11px]"
                        style={{
                          fontFamily: "var(--font-ibm-plex-mono,'IBM Plex Mono',monospace)",
                          color: '#94a3b8',
                        }}
                      >
                        {item.employeeNumber}
                      </p>
                    )}
                  </td>

                  {/* Certification */}
                  <td className="px-4 py-3">
                    <span className="font-medium" style={{ color: '#0f172a' }}>
                      {item.certificationName}
                    </span>
                    {item.issuer && (
                      <p className="mt-0.5 text-[11px]" style={{ color: '#94a3b8' }}>
                        {item.issuer}
                      </p>
                    )}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                      style={CERT_STATUS_STYLE[item.status] ?? CERT_STATUS_STYLE.ACTIVE}
                    >
                      {CERT_STATUS_LABELS[item.status] ?? item.status}
                    </span>
                  </td>

                  {/* Issue Date */}
                  <td className="whitespace-nowrap px-4 py-3" style={{ color: '#475569' }}>
                    {item.issueDate ? formatDate(item.issueDate) : '—'}
                  </td>

                  {/* Expiration Date */}
                  <td className="whitespace-nowrap px-4 py-3" style={{ color: '#475569' }}>
                    {formatDate(item.expirationDate)}
                  </td>

                  {/* Days Remaining */}
                  <td className="px-4 py-3">
                    <DaysRemainingPill days={days} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
