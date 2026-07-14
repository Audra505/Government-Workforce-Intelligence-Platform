'use client';

// Edit Department form — Client Component.
// PATCH /api/departments/:id → BFF → NestJS PATCH /api/v1/departments/:id.
// CODE_CONFLICT (409) mapped to inline form-level error.
// Does not send status field — deactivation is handled by DeactivateDepartment.
// Reference: governance/GD-M25-1.md — Decisions 2, 7, 10, 12

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { DepartmentRow, UpdateDepartmentBffResponse } from '@/features/admin/types';

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name must be 255 characters or fewer'),
  code: z.string().min(1, 'Code is required').max(100, 'Code must be 100 characters or fewer'),
  description: z
    .string()
    .max(500, 'Description must be 500 characters or fewer')
    .optional()
    .or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

const ERROR_MESSAGES: Record<string, string> = {
  CONFLICT: 'A department with this code already exists. Choose a different code.',
};

const INPUT_CLASS =
  'block w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

const BLUE   = '#2563eb';
const TEXT   = '#0f172a';
const SUB    = '#475569';
const BORDER = '#e2e8f0';

type Props = { department: DepartmentRow };

export function EditDepartmentForm({ department }: Props) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: department.name,
      code: department.code,
      description: department.description ?? '',
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);

    const payload: Record<string, string | null> = {
      name: values.name,
      code: values.code,
      description: values.description || null,
    };

    let res: Response;
    try {
      res = await fetch(`/api/departments/${department.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setServerError('Unable to reach the server. Please try again.');
      return;
    }

    const json = (await res.json()) as UpdateDepartmentBffResponse;
    if (json.success) {
      router.push(`/admin/departments/${department.id}`);
      router.refresh();
    } else {
      setServerError(ERROR_MESSAGES[json.error.code] ?? json.error.message);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      {serverError && (
        <div
          className="mb-6 rounded-md border px-4 py-3 text-sm"
          style={{ borderColor: '#fca5a5', backgroundColor: '#fef2f2', color: '#dc2626' }}
          role="alert"
        >
          {serverError}
        </div>
      )}

      <div className="space-y-5">
        <div>
          <label className="mb-1.5 block text-sm font-medium" style={{ color: TEXT }} htmlFor="dept-name">
            Name <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            id="dept-name"
            type="text"
            autoComplete="off"
            className={INPUT_CLASS}
            style={{ borderColor: errors.name ? '#dc2626' : BORDER, color: TEXT }}
            {...register('name')}
          />
          {errors.name && (
            <p className="mt-1 text-xs" style={{ color: '#dc2626' }}>{errors.name.message}</p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" style={{ color: TEXT }} htmlFor="dept-code">
            Code <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            id="dept-code"
            type="text"
            autoComplete="off"
            className={INPUT_CLASS}
            style={{ borderColor: errors.code ? '#dc2626' : BORDER, color: TEXT }}
            {...register('code')}
          />
          {errors.code && (
            <p className="mt-1 text-xs" style={{ color: '#dc2626' }}>{errors.code.message}</p>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium" style={{ color: TEXT }} htmlFor="dept-description">
            Description <span className="font-normal" style={{ color: SUB }}>(optional)</span>
          </label>
          <textarea
            id="dept-description"
            rows={3}
            className={INPUT_CLASS}
            style={{ borderColor: errors.description ? '#dc2626' : BORDER, color: TEXT, resize: 'vertical' }}
            {...register('description')}
          />
          {errors.description && (
            <p className="mt-1 text-xs" style={{ color: '#dc2626' }}>{errors.description.message}</p>
          )}
        </div>
      </div>

      <div className="mt-8 flex items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-md px-5 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-60"
          style={{ backgroundColor: BLUE }}
        >
          {isSubmitting ? 'Saving…' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/admin/departments/${department.id}`)}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-100"
          style={{ color: SUB, borderColor: BORDER }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
