// Employee detail display — Server Component.
// Renders all API fields for a single employee record in labeled card sections.
// EMP-400/EMP-401: audit metadata not exposed in UI; PII-bearing fields shown only
// to roles that passed NestJS RBAC (SA, HR, WP, HM, CO — RBAC-952 excludes Executive User).
// currentPositionTitle: resolved by parent page via secondary serverFetch; null when unavailable.
// Reference: directives/13_employee_management_rules.md — EMP-302 (SEPARATED read-only indicator)
// Reference: governance/GD-M15-1.md — Decision 5, 7 (positionId in employee response)

import type { ReactNode } from 'react';
import type { EmployeeRow } from '@/features/workforce/types';
import { EmploymentStatusBadge } from '@/features/workforce/components/employee-status-badge';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

type Props = {
  employee: EmployeeRow;
  currentPositionTitle: string | null;
};

export function EmployeeDetail({ employee, currentPositionTitle }: Props) {
  const isSeparated = employee.employmentStatus === 'SEPARATED';

  return (
    <div className="space-y-6">
      {/* EMP-302: Read-only indicator for SEPARATED employees */}
      {isSeparated && (
        <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-4 py-3">
          <span className="text-sm font-medium text-gray-600">
            Read-only — Separated employees cannot be modified.
          </span>
        </div>
      )}

      {/* Personal Information */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Personal Information
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="First Name">{employee.firstName}</Field>
          <Field label="Last Name">{employee.lastName}</Field>
          <Field label="Email">
            {employee.email ? (
              <a
                href={`mailto:${employee.email}`}
                className="text-primary hover:underline"
              >
                {employee.email}
              </a>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
        </dl>
      </div>

      {/* Employment Information */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Employment
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Employee Number">
            <span className="font-mono text-sm">{employee.employeeNumber}</span>
          </Field>
          <Field label="Department">{employee.departmentName}</Field>
          <Field label="Current Position">
            {employee.positionId ? (
              currentPositionTitle ? (
                <span>{currentPositionTitle}</span>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">
                  {employee.positionId}
                  <span className="ml-1 font-sans text-xs not-italic"> — title unavailable</span>
                </span>
              )
            ) : (
              <span className="text-muted-foreground">
                Unassigned — no position is currently held.
              </span>
            )}
          </Field>
          <Field label="Status">
            <EmploymentStatusBadge status={employee.employmentStatus} />
          </Field>
          <Field label="Hire Date">
            {employee.hireDate ? formatDate(employee.hireDate) : <span className="text-muted-foreground">—</span>}
          </Field>
          {/* EMP-303: terminationDate system-managed; rendered when present (SEPARATED only) */}
          {employee.terminationDate && (
            <Field label="Termination Date">{formatDate(employee.terminationDate)}</Field>
          )}
        </dl>
      </div>

      {/* Timeline */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Timeline
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Created">{formatDate(employee.createdAt)}</Field>
          <Field label="Last Updated">{formatDate(employee.updatedAt)}</Field>
        </dl>
      </div>

      {/* Identifiers */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Identifiers
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Field label="Employee ID">
            <span className="font-mono text-xs text-muted-foreground">{employee.id}</span>
          </Field>
        </dl>
      </div>
    </div>
  );
}
