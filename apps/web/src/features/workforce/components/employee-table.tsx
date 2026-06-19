// Employee list table — Server Component.
// Renders employee rows; employee full name links to /workforce/employees/:id.
// RBAC-952: Executive User is excluded from list endpoint at the API level — this component
// never renders for Executive Users.
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-002, RBAC-952

import Link from 'next/link';
import type { EmployeeRow } from '@/features/workforce/types';
import { EmploymentStatusBadge } from '@/features/workforce/components/employee-status-badge';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

type Props = {
  employees: EmployeeRow[];
  hasFilters: boolean;
};

export function EmployeeTable({ employees, hasFilters }: Props) {
  if (employees.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">
          {hasFilters
            ? 'No employees match the current filters.'
            : 'No employees found in your organization.'}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Employee #</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Department</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Hire Date</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => (
            <tr
              key={e.id}
              className="border-b last:border-0 hover:bg-muted/30 transition-colors relative"
            >
              <td className="px-4 py-3 font-medium">
                <Link
                  href={`/workforce/employees/${e.id}`}
                  className="hover:underline after:absolute after:inset-0 after:content-['']"
                >
                  {e.firstName} {e.lastName}
                </Link>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                {e.employeeNumber}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{e.departmentName}</td>
              <td className="px-4 py-3">
                <EmploymentStatusBadge status={e.employmentStatus} />
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {e.hireDate ? formatDate(e.hireDate) : '—'}
              </td>
              <td className="px-4 py-3 text-muted-foreground">{e.email ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
