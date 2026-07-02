// Vacancy detail display component.
// M21C: VacancyStatusDot replaces StatusBadge; IBM Plex Mono for IDs.
// Server Component — renders all 15 API fields for a single vacancy record.
// PriorityBadge and AgingCell retained as-is per GD-M21-1 D10.
// Reference: apps/api/src/workforce/dto/vacancy-response.dto.ts — field definitions
// Reference: directives/03_vacancy_management_rules.md — VAC-601 (requiresReview), VAC-701/702 (aging)

import type { ReactNode } from 'react';
import type { VacancyRow } from '@/features/workforce/types';
import {
  VacancyStatusDot,
  PriorityBadge,
  AgingCell,
} from '@/features/workforce/components/vacancy-badges';

const MONO_ID_STYLE = {
  fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)",
  fontSize: 12,
  color: '#94a3b8',
} as const;

// ---------------------------------------------------------------------------
// Reason labels — authority: directives/03 Vacancy Reasons
// ---------------------------------------------------------------------------

const REASON_LABELS: Record<string, string> = {
  NEW_POSITION:       'New Position',
  RETIREMENT:         'Retirement',
  RESIGNATION:        'Resignation',
  TRANSFER:           'Transfer',
  TERMINATION:        'Termination',
  EXPANSION:          'Expansion',
  TEMPORARY_COVERAGE: 'Temporary Coverage',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

type Props = { vacancy: VacancyRow };

export function VacancyDetail({ vacancy }: Props) {
  return (
    <div className="space-y-6">
      {/* Review Required indicator — VAC-601: CRITICAL + OPEN */}
      {vacancy.requiresReview && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3">
          <span className="text-sm font-medium text-red-700">
            Review Required — Critical vacancy requires HR Director review.
          </span>
        </div>
      )}

      {/* Primary fields */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Vacancy Details
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Position">
            <span className="font-medium">{vacancy.positionTitle}</span>
          </Field>
          <Field label="Department">{vacancy.departmentName}</Field>
          <Field label="Status">
            <VacancyStatusDot status={vacancy.status} />
          </Field>
          <Field label="Priority">
            {vacancy.priority ? (
              <PriorityBadge priority={vacancy.priority} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <Field label="Reason">
            {vacancy.reason ? (
              REASON_LABELS[vacancy.reason] ?? vacancy.reason
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
          <Field label="Expected Fill Date">
            {vacancy.expectedFillDate ? (
              formatDate(vacancy.expectedFillDate)
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Field>
          {/* Closure Type — derived from filledAt; shown only when CLOSED */}
          {vacancy.status === 'CLOSED' && (
            <Field label="Closure Type">
              {vacancy.filledAt ? 'Filled' : 'Cancelled'}
            </Field>
          )}
        </dl>
      </div>

      {/* Timeline */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Timeline
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Age">
            <AgingCell ageInDays={vacancy.ageInDays} agingStatus={vacancy.agingStatus} />
          </Field>
          <Field label="Created">{formatDate(vacancy.createdAt)}</Field>
          {/* FILLED closures omit updatedAt (redundant with filledAt — same transaction).
              CANCELLED closures label updatedAt as "Closed" — it is the close timestamp.
              Active vacancies keep the "Last Updated" label. */}
          {!(vacancy.status === 'CLOSED' && vacancy.filledAt) && (
            <Field label={vacancy.status === 'CLOSED' ? 'Closed' : 'Last Updated'}>
              {formatDate(vacancy.updatedAt)}
            </Field>
          )}
          {vacancy.filledAt && (
            <Field label="Filled">{formatDate(vacancy.filledAt)}</Field>
          )}
        </dl>
      </div>

      {/* Technical identifiers */}
      <div className="rounded-md border p-6">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Identifiers
        </h3>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <Field label="Vacancy ID">
            <span style={MONO_ID_STYLE}>{vacancy.id}</span>
          </Field>
          <Field label="Position ID">
            <span style={MONO_ID_STYLE}>{vacancy.positionId}</span>
          </Field>
        </dl>
      </div>
    </div>
  );
}
