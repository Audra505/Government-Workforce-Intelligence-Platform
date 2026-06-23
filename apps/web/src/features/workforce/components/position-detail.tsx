// Position detail display — Server Component.
// Renders all position fields and the Occupant section (GD-M15-1 D7).
// Occupant section shows name, employeeNumber, employmentStatus, hireDate with link to employee.
// "Vacant" displayed when occupant is null.
// Reference: governance/GD-M15-1.md — Decision 7 (occupant response contract)
// Reference: governance/GD-PHASE2-CLOSURE-002.md — Decision 3 (UI surface requirement)

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { PositionDetailRow } from '@/features/workforce/types';
import { PositionStatusBadge } from '@/features/workforce/components/position-status-badge';
import { EmploymentStatusBadge } from '@/features/workforce/components/employee-status-badge';

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

function formatDateStr(dateStr: string): string {
  // YYYY-MM-DD — add noon UTC to avoid off-by-one from timezone shifts
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(dateStr + 'T12:00:00Z'));
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

type Props = { position: PositionDetailRow };

export function PositionDetail({ position }: Props) {
  return (
    <div className="space-y-6">
      {/* Core fields */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Position Details
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Title">
            <span className="font-medium">{position.title}</span>
          </Field>
          <Field label="Status">
            <PositionStatusBadge status={position.status} />
          </Field>
          <Field label="Classification">
            {position.classification ?? <span className="text-muted-foreground">—</span>}
          </Field>
          <Field label="Salary Band">
            {position.salaryBand ?? <span className="text-muted-foreground">—</span>}
          </Field>
        </dl>
      </div>

      {/* Occupant — GD-M15-1 D7; GD-PHASE2-CLOSURE-002 D3 */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Current Occupant
        </h3>
        {position.occupant ? (
          <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Name">
              <Link
                href={`/workforce/employees/${position.occupant.id}`}
                className="font-medium text-primary hover:underline"
              >
                {position.occupant.firstName} {position.occupant.lastName}
              </Link>
            </Field>
            <Field label="Employee Number">
              <span className="font-mono text-sm">
                {position.occupant.employeeNumber ?? '—'}
              </span>
            </Field>
            <Field label="Status">
              <EmploymentStatusBadge
                status={position.occupant.employmentStatus as Parameters<typeof EmploymentStatusBadge>[0]['status']}
              />
            </Field>
            <Field label="Hire Date">
              {position.occupant.hireDate
                ? formatDateStr(position.occupant.hireDate)
                : <span className="text-muted-foreground">—</span>}
            </Field>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Vacant — no employee is currently assigned to this position.</p>
        )}
      </div>

      {/* Timeline */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Timeline
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Created">{formatDate(position.createdAt)}</Field>
        </dl>
      </div>

      {/* Identifiers */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Identifiers
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Field label="Position ID">
            <span className="font-mono text-xs text-muted-foreground">{position.id}</span>
          </Field>
          <Field label="Department ID">
            <span className="font-mono text-xs text-muted-foreground">{position.departmentId}</span>
          </Field>
        </dl>
      </div>
    </div>
  );
}
