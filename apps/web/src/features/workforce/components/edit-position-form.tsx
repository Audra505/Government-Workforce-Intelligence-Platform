'use client';

// Edit Position form — React Hook Form + Zod.
// Calls BFF PUT /api/positions/:id (not NestJS directly — JWT is in httpOnly cookie).
// Status intentionally ABSENT — lifecycle transitions are performed via action buttons
// on the detail page, not via the edit form. (GD-PHASE2-CLOSURE-002 D3)
// tenantId not in form — derived from JWT by NestJS (SEC-003).
// Reference: directives/02_position_management_rules.md — POS-AUTH-002
// Reference: governance/GD-PHASE2-CLOSURE-002.md — Decision 3 (status editable via lifecycle only)

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { PositionRow, UpdatePositionBffResponse } from '@/features/workforce/types';

const schema = z.object({
  title:          z.string().min(1, 'Title cannot be empty').optional().or(z.literal('')),
  classification: z.string().optional(),
  salaryBand:     z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const ERROR_MESSAGES: Record<string, string> = {
  NOT_FOUND:        'This position could not be found.',
  POSITION_CLOSED:  'Closed positions cannot be edited.',
  FORBIDDEN:        "You don't have permission to edit positions.",
  UNAUTHORIZED:     'Session expired. Please sign in again.',
  VALIDATION_ERROR: 'Invalid form data. Please review your entries.',
  INTERNAL_ERROR:   'Service unavailable. Please try again.',
};

const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

type Props = { position: PositionRow };

export function EditPositionForm({ position }: Props) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title:          position.title,
      classification: position.classification ?? '',
      salaryBand:     position.salaryBand ?? '',
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    setIsLoading(true);

    const body: Record<string, string> = {};
    if (values.title)          body.title          = values.title;
    if (values.classification) body.classification = values.classification;
    if (values.salaryBand)     body.salaryBand     = values.salaryBand;

    try {
      const res = await fetch(`/api/positions/${position.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        router.push(`/workforce/positions/${position.id}`);
        router.refresh();
        return;
      }

      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as UpdatePositionBffResponse;
        if (!data.success && data.error?.code) errorCode = data.error.code;
      } catch { /* body parse failed */ }

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

      {/* Status — read-only display; lifecycle actions control transitions */}
      <div className="space-y-1 rounded-md border bg-muted/30 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Status (read-only — use lifecycle actions on detail page)
        </p>
        <p className="text-sm font-medium capitalize">{position.status.toLowerCase()}</p>
      </div>

      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <input
          id="title"
          type="text"
          {...register('title')}
          className={INPUT_CLASS}
          aria-describedby={errors.title ? 'title-error' : undefined}
        />
        {errors.title && (
          <p id="title-error" className="text-sm text-destructive">{errors.title.message}</p>
        )}
      </div>

      {/* Classification */}
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

      {/* Salary Band */}
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

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" size="sm" disabled={isLoading}>
          {isLoading ? 'Saving…' : 'Save Changes'}
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/workforce/positions/${position.id}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
