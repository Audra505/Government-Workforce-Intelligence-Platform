// Position detail display — Server Component.
// M21C: PositionStatusDot/EmploymentStatusDot replace pill badges; IBM Plex Mono for IDs.
// Occupant section shows name, employeeNumber, employmentStatus, hireDate with link to employee.
// "Vacant" displayed when occupant is null.
// Reference: governance/GD-M15-1.md — Decision 7 (occupant response contract)
// Reference: governance/GD-PHASE2-CLOSURE-002.md — Decision 3 (UI surface requirement)

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { PositionDetailRow } from '@/features/workforce/types';
import { PositionStatusDot } from '@/features/workforce/components/position-status-badge';
import { EmploymentStatusDot } from '@/features/workforce/components/employee-status-badge';

const MONO_STYLE = {
  fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)",
} as const;

const MONO_ID_STYLE = {
  fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)",
  fontSize: 12,
  color: '#94a3b8',
} as const;

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
            <PositionStatusDot status={position.status} />
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
              <span style={MONO_STYLE}>
                {position.occupant.employeeNumber ?? '—'}
              </span>
            </Field>
            <Field label="Status">
              <EmploymentStatusDot
                status={position.occupant.employmentStatus as Parameters<typeof EmploymentStatusDot>[0]['status']}
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
            <span style={MONO_ID_STYLE}>{position.id}</span>
          </Field>
          <Field label="Department ID">
            <span style={MONO_ID_STYLE}>{position.departmentId}</span>
          </Field>
        </dl>
      </div>
    </div>
  );
}
