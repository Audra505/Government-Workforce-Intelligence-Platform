'use client';

// Create Position form — React Hook Form + Zod.
// Calls BFF POST /api/positions (not NestJS directly — JWT is in httpOnly cookie).
// Status not in form — NestJS defaults to DRAFT per POS-001.
// tenantId not in form — derived from JWT by NestJS (SEC-003).
// Reference: directives/02_position_management_rules.md — POS-001, POS-AUTH-001
// Reference: governance/GD-PHASE2-CLOSURE-002.md — Decision 3

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { DepartmentOption, CreatePositionBffResponse } from '@/features/workforce/types';

const schema = z.object({
  title:          z.string().min(1, 'Title is required'),
  departmentId:   z.string().uuid('Please select a department'),
  classification: z.string().optional(),
  salaryBand:     z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const ERROR_MESSAGES: Record<string, string> = {
  DEPARTMENT_NOT_FOUND: 'The selected department is no longer available. Please refresh and try again.',
  FORBIDDEN:            "You don't have permission to create positions.",
  UNAUTHORIZED:         'Session expired. Please sign in again.',
  VALIDATION_ERROR:     'Invalid form data. Please review your entries.',
  INTERNAL_ERROR:       'Service unavailable. Please try again.',
};

const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

type Props = { departments: DepartmentOption[] };

export function CreatePositionForm({ departments }: Props) {
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

  const hasNoDepartments = departments.length === 0;

  async function onSubmit(values: FormValues) {
    setServerError(null);
    setIsLoading(true);

    const body: Record<string, string> = {
      title:        values.title,
      departmentId: values.departmentId,
    };
    if (values.classification) body.classification = values.classification;
    if (values.salaryBand)     body.salaryBand     = values.salaryBand;

    try {
      const res = await fetch('/api/positions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      let parsed: CreatePositionBffResponse | null = null;
      try {
        parsed = (await res.json()) as CreatePositionBffResponse;
      } catch { /* body parse failed */ }

      if (res.status === 201 && parsed?.success) {
        router.push(`/workforce/positions/${(parsed as Extract<CreatePositionBffResponse, { success: true }>).data.id}`);
        return;
      }

      const errorCode =
        parsed && !parsed.success ? (parsed.error?.code ?? 'INTERNAL_ERROR') : 'INTERNAL_ERROR';

      setServerError(ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.INTERNAL_ERROR);
    } catch {
      setServerError('Unable to reach the server. Please check your connection.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
      {serverError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {serverError}
        </div>
      )}

      {/* Title — required */}
      <div className="space-y-2">
        <Label htmlFor="title">
          Title <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        <input
          id="title"
          type="text"
          {...register('title')}
          className={INPUT_CLASS}
          placeholder="e.g. Senior Policy Analyst"
          aria-describedby={errors.title ? 'title-error' : undefined}
        />
        {errors.title && (
          <p id="title-error" className="text-sm text-destructive">{errors.title.message}</p>
        )}
      </div>

      {/* Department — required */}
      <div className="space-y-2">
        <Label htmlFor="departmentId">
          Department <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        {hasNoDepartments ? (
          <p className="text-sm text-muted-foreground">
            No active departments available. Create and activate a department before adding positions.
          </p>
        ) : (
          <select
            id="departmentId"
            {...register('departmentId')}
            className={INPUT_CLASS}
            aria-describedby={errors.departmentId ? 'departmentId-error' : undefined}
          >
            <option value="">Select a department...</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>
        )}
        {errors.departmentId && (
          <p id="departmentId-error" className="text-sm text-destructive">{errors.departmentId.message}</p>
        )}
      </div>

      {/* Classification — optional */}
      <div className="space-y-2">
        <Label htmlFor="classification">Classification</Label>
        <input
          id="classification"
          type="text"
          {...register('classification')}
          className={INPUT_CLASS}
          placeholder="e.g. GS-13"
          aria-describedby={errors.classification ? 'classification-error' : undefined}
        />
        {errors.classification && (
          <p id="classification-error" className="text-sm text-destructive">{errors.classification.message}</p>
        )}
      </div>

      {/* Salary Band — optional */}
      <div className="space-y-2">
        <Label htmlFor="salaryBand">Salary Band</Label>
        <input
          id="salaryBand"
          type="text"
          {...register('salaryBand')}
          className={INPUT_CLASS}
          placeholder="e.g. $90,000-$115,000"
          aria-describedby={errors.salaryBand ? 'salaryBand-error' : undefined}
        />
        <p className="text-xs text-muted-foreground">
          Use the format $MIN-$MAX, e.g. $90,000-$115,000
        </p>
        {errors.salaryBand && (
          <p id="salaryBand-error" className="text-sm text-destructive">{errors.salaryBand.message}</p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Positions are created in Draft status. Use the Activate action on the detail page to make a position available.
      </p>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" style={{ backgroundColor: '#2563eb' }} disabled={isLoading || hasNoDepartments}>
          {isLoading ? 'Creating...' : 'Create Position'}
        </Button>
        <Button asChild variant="outline">
          <Link href="/workforce/positions">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
