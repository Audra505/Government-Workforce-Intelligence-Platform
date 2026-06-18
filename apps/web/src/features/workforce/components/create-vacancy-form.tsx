'use client';

// Create Vacancy form — React Hook Form + Zod.
// Calls BFF POST /api/vacancies (not NestJS directly — JWT is in httpOnly cookie).
// positionId: select from ACTIVE positions passed as prop from Server Component.
// priority/reason: static enum selects per VAC-200 and directives/03 Vacancy Reasons.
// expectedFillDate: must be strictly in the future (GD-10-1 — frontend validation only).
// Reference: directives/03_vacancy_management_rules.md — VAC-100, VAC-200, Vacancy Reasons
// Reference: M11 Step 10 Governance Decisions — GD-10-1, GD-10-2, GD-10-3

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { PositionOption, CreateVacancyBffResponse } from '@/features/workforce/types';

// ---------------------------------------------------------------------------
// Constants — authority: directives/03 Vacancy Reasons + VAC-200
// ---------------------------------------------------------------------------

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
] as const;

const REASON_OPTIONS = [
  { value: 'NEW_POSITION', label: 'New Position' },
  { value: 'RETIREMENT', label: 'Retirement' },
  { value: 'RESIGNATION', label: 'Resignation' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'TERMINATION', label: 'Termination' },
  { value: 'EXPANSION', label: 'Expansion' },
  { value: 'TEMPORARY_COVERAGE', label: 'Temporary Coverage' },
] as const;

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const schema = z.object({
  positionId: z.string().min(1, 'Please select a position'),
  priority: z.enum(
    ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    { message: 'Please select a priority' },
  ),
  reason: z.enum(
    ['NEW_POSITION', 'RETIREMENT', 'RESIGNATION', 'TRANSFER', 'TERMINATION', 'EXPANSION', 'TEMPORARY_COVERAGE'],
    { message: 'Please select a reason' },
  ),
  expectedFillDate: z
    .string()
    .min(1, 'Please enter an expected fill date')
    .refine(
      (d) => {
        const input = new Date(d + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return input > today;
      },
      'Expected fill date must be in the future',
    ),
});

type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Error message map — keyed by NestJS error code
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  POSITION_NOT_ELIGIBLE: 'Selected position is no longer eligible. Please choose another position.',
  FORBIDDEN: "You don't have permission to create vacancies.",
  UNAUTHORIZED: 'Session expired. Please sign in again.',
  VALIDATION_ERROR: 'Invalid form data. Please review your entries.',
  INTERNAL_ERROR: 'Service unavailable. Please try again.',
};

// ---------------------------------------------------------------------------
// Shared input class — matches VacancyFilters select styling
// ---------------------------------------------------------------------------

const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Props = { positions: PositionOption[] };

export function CreateVacancyForm({ positions }: Props) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const hasNoPositions = positions.length === 0;

  async function onSubmit(values: FormValues) {
    setServerError(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/vacancies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      if (res.status === 201) {
        router.push('/workforce/vacancies');
        return;
      }

      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as CreateVacancyBffResponse;
        if (!data.success && data.error?.code) {
          errorCode = data.error.code;
        }
      } catch {
        // body parse failed — use default error code
      }

      setServerError(ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.INTERNAL_ERROR);
    } catch {
      setServerError('Unable to reach the server. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      {/* Form-level error banner */}
      {serverError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {serverError}
        </div>
      )}

      {/* Position */}
      <div className="space-y-2">
        <Label htmlFor="positionId">
          Position{' '}
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        </Label>
        {hasNoPositions ? (
          <p className="text-sm text-muted-foreground">
            No active positions available. Create and activate a position before creating a vacancy.
          </p>
        ) : (
          <select
            id="positionId"
            {...register('positionId')}
            className={INPUT_CLASS}
            aria-describedby={errors.positionId ? 'positionId-error' : undefined}
          >
            <option value="">Select a position...</option>
            {positions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
                {p.classification ? ` — ${p.classification}` : ''}
              </option>
            ))}
          </select>
        )}
        {errors.positionId && (
          <p id="positionId-error" className="text-sm text-destructive">
            {errors.positionId.message}
          </p>
        )}
      </div>

      {/* Priority */}
      <div className="space-y-2">
        <Label htmlFor="priority">
          Priority{' '}
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        </Label>
        <select
          id="priority"
          {...register('priority')}
          className={INPUT_CLASS}
          aria-describedby={errors.priority ? 'priority-error' : undefined}
        >
          <option value="">Select a priority...</option>
          {PRIORITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {errors.priority && (
          <p id="priority-error" className="text-sm text-destructive">
            {errors.priority.message}
          </p>
        )}
      </div>

      {/* Reason */}
      <div className="space-y-2">
        <Label htmlFor="reason">
          Reason{' '}
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        </Label>
        <select
          id="reason"
          {...register('reason')}
          className={INPUT_CLASS}
          aria-describedby={errors.reason ? 'reason-error' : undefined}
        >
          <option value="">Select a reason...</option>
          {REASON_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {errors.reason && (
          <p id="reason-error" className="text-sm text-destructive">
            {errors.reason.message}
          </p>
        )}
      </div>

      {/* Expected Fill Date */}
      <div className="space-y-2">
        <Label htmlFor="expectedFillDate">
          Expected Fill Date{' '}
          <span aria-hidden="true" className="text-destructive">
            *
          </span>
        </Label>
        <input
          id="expectedFillDate"
          type="date"
          {...register('expectedFillDate')}
          className={INPUT_CLASS}
          aria-describedby={errors.expectedFillDate ? 'expectedFillDate-error' : undefined}
        />
        {errors.expectedFillDate && (
          <p id="expectedFillDate-error" className="text-sm text-destructive">
            {errors.expectedFillDate.message}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isLoading || hasNoPositions}>
          {isLoading ? 'Creating...' : 'Create Vacancy'}
        </Button>
        <Button asChild variant="outline">
          <Link href="/workforce/vacancies">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
