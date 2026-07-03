'use client';

// Edit Vacancy form — React Hook Form + Zod.
// Calls BFF PUT /api/vacancies/[id] (not NestJS directly — JWT is in httpOnly cookie).
// All fields optional: partial update — only changed/present values sent to API.
// reason field hidden for OPEN/IN_RECRUITMENT vacancies — service silently discards it (GD-12-3).
// expectedFillDate must be in the future if provided (GD-12-5).
// Empty submissions allowed — service returns SUCCESS for no-op updates (GD-12-6).
// Reference: directives/03_vacancy_management_rules.md — VAC-200, VAC-501
// Reference: M11 Step 12 Governance — GD-12-3, GD-12-5, GD-12-6

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { VacancyRow, UpdateVacancyBffResponse } from '@/features/workforce/types';

// ---------------------------------------------------------------------------
// Constants
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

const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const editSchema = z.object({
  priority: z.string().optional(),
  reason: z.string().optional(),
  expectedFillDate: z
    .string()
    .optional()
    .refine(
      (d) => {
        if (!d) return true; // Optional — empty means "don't change"
        const input = new Date(d + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return input > today;
      },
      'Expected fill date must be in the future',
    ),
});

type FormValues = z.infer<typeof editSchema>;

// ---------------------------------------------------------------------------
// Error message map
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  VACANCY_CLOSED: 'This vacancy is closed and cannot be edited.',
  NOT_FOUND: 'This vacancy could not be found.',
  FORBIDDEN: "You don't have permission to edit vacancies.",
  UNAUTHORIZED: 'Session expired. Please sign in again.',
  VALIDATION_ERROR: 'Invalid form data. Please review your entries.',
  INTERNAL_ERROR: 'Service unavailable. Please try again.',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Convert ISO date string ("2027-01-15T00:00:00.000Z") to date input value ("2027-01-15").
function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  return iso.substring(0, 10);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Props = { vacancy: VacancyRow };

export function EditVacancyForm({ vacancy }: Props) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const showReason = vacancy.status === 'DRAFT';

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      priority: vacancy.priority ?? undefined,
      reason: vacancy.reason ?? undefined,
      expectedFillDate: toDateInputValue(vacancy.expectedFillDate),
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    setIsLoading(true);

    // Only include fields with values — omitting a field means "no change" on the server.
    const body: Record<string, string> = {};
    if (values.priority) body.priority = values.priority;
    if (showReason && values.reason) body.reason = values.reason;
    if (values.expectedFillDate) body.expectedFillDate = values.expectedFillDate;

    try {
      const res = await fetch(`/api/vacancies/${vacancy.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        router.push(`/workforce/vacancies/${vacancy.id}`);
        router.refresh();
        return;
      }

      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as UpdateVacancyBffResponse;
        if (!data.success && data.error?.code) {
          errorCode = data.error.code;
        }
      } catch {
        // body parse failed — use default
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

      {/* Priority */}
      <div className="space-y-2">
        <Label htmlFor="priority">Priority</Label>
        <select
          id="priority"
          {...register('priority')}
          className={INPUT_CLASS}
          aria-describedby={errors.priority ? 'priority-error' : undefined}
        >
          <option value="">No change</option>
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

      {/* Reason — DRAFT only (GD-12-3) */}
      {showReason && (
        <div className="space-y-2">
          <Label htmlFor="reason">Reason</Label>
          <select
            id="reason"
            {...register('reason')}
            className={INPUT_CLASS}
            aria-describedby={errors.reason ? 'reason-error' : undefined}
          >
            <option value="">No change</option>
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
      )}

      {/* Expected Fill Date */}
      <div className="space-y-2">
        <Label htmlFor="expectedFillDate">Expected Fill Date</Label>
        <div className="flex items-center gap-2">
          <input
            id="expectedFillDate"
            type="date"
            {...register('expectedFillDate')}
            className={INPUT_CLASS}
            aria-describedby={errors.expectedFillDate ? 'expectedFillDate-error' : undefined}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setValue('expectedFillDate', '', { shouldValidate: false })}
          >
            Clear
          </Button>
        </div>
        {errors.expectedFillDate && (
          <p id="expectedFillDate-error" className="text-sm text-destructive">
            {errors.expectedFillDate.message}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Date must be in the future if provided.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" size="sm" style={{ backgroundColor: '#2563eb' }} disabled={isLoading}>
          {isLoading ? 'Saving…' : 'Save Changes'}
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/workforce/vacancies/${vacancy.id}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
