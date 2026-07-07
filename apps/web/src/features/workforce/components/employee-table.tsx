// Employee list table — Server Component.
// M21C: EmploymentStatusDot replaces EmploymentStatusBadge; IBM Plex Mono for employee #.
// M23: Pill status, Employee # first, email column removed, table shadow/radius per mockup.
// RBAC-952: Executive User excluded from list endpoint at the API level.
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-002, RBAC-952

import Link from 'next/link';
import type { EmployeeRow } from '@/features/workforce/types';
import { EmploymentStatusDot } from '@/features/workforce/components/employee-status-badge';
import { EmptyState } from '@/components/shared/empty-state';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

const TH_STYLE = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.09em',
  color: '#94a3b8',
  backgroundColor: '#f8fafc',
  whiteSpace: 'nowrap',
} as const;

const TD_ID_STYLE = {
  fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)",
  fontSize: 11,
  color: '#94a3b8',
  whiteSpace: 'nowrap',
} as const;

type Props = {
  employees: EmployeeRow[];
  hasFilters: boolean;
};

export function EmployeeTable({ employees, hasFilters }: Props) {
  if (employees.length === 0) {
    return (
      <EmptyState
        message={hasFilters
          ? 'No employees match the current filters.'
          : 'No employees found in your organization.'}
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
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Employee #</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Name</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Department</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Status</th>
              <th className="px-4 py-2.5 text-left uppercase" style={TH_STYLE}>Hire Date</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr
                key={e.id}
                className="relative h-12 border-b last:border-0 transition-colors hover:bg-slate-50"
                style={{ borderColor: '#e2e8f0' }}
              >
                <td className="px-4 py-3" style={TD_ID_STYLE}>{e.employeeNumber}</td>
                <td className="px-4 py-3 font-medium">
                  <Link
                    href={`/workforce/employees/${e.id}`}
                    className="hover:underline after:absolute after:inset-0 after:content-['']"
                    style={{ color: '#2563eb' }}
                  >
                    {e.firstName} {e.lastName}
                  </Link>
                </td>
                <td className="px-4 py-3" style={{ color: '#475569' }}>{e.departmentName}</td>
                <td className="px-4 py-3">
                  <EmploymentStatusDot status={e.employmentStatus} />
                </td>
                <td className="px-4 py-3" style={{ color: '#475569' }}>
                  {e.hireDate ? formatDate(e.hireDate) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
