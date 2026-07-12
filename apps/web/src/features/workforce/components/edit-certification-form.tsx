'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { CertificationRow, UpdateCertificationBffResponse } from '@/features/workforce/types';

const schema = z.object({
  name: z.string().min(1, 'Name is required').max(120, 'Name must be 120 characters or fewer'),
  issuer: z.string().max(120, 'Issuer must be 120 characters or fewer').optional().or(z.literal('')),
  expirationRequired: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

const ERROR_MESSAGES: Record<string, string> = {
  CERTIFICATION_NAME_CONFLICT: 'A certification with this name already exists. Choose a different name.',
};

const INPUT_CLASS =
  'block w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500';

const BLUE = '#2563eb';
const TEXT = '#0f172a';
const SUB = '#475569';
const BORDER = '#e2e8f0';

type Props = { certification: CertificationRow };

export function EditCertificationForm({ certification }: Props) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: certification.name,
      issuer: certification.issuer ?? '',
      expirationRequired: certification.expirationRequired,
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);

    const payload: Record<string, unknown> = {
      name: values.name,
      expirationRequired: values.expirationRequired,
      issuer: values.issuer || null,
    };

    let res: Response;
    try {
      res = await fetch(`/api/certifications/${certification.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      setServerError('Unable to reach the server. Please try again.');
      return;
    }

    const json = (await res.json()) as UpdateCertificationBffResponse;
    if (json.success) {
      router.push('/workforce/certifications');
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
        {/* Name */}
        <div>
          <label className="mb-1.5 block text-sm font-medium" style={{ color: TEXT }} htmlFor="cert-name">
            Name <span style={{ color: '#dc2626' }}>*</span>
          </label>
          <input
            id="cert-name"
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

        {/* Issuer */}
        <div>
          <label className="mb-1.5 block text-sm font-medium" style={{ color: TEXT }} htmlFor="cert-issuer">
            Issuer <span className="font-normal" style={{ color: SUB }}>(optional)</span>
          </label>
          <input
            id="cert-issuer"
            type="text"
            autoComplete="off"
            className={INPUT_CLASS}
            style={{ borderColor: errors.issuer ? '#dc2626' : BORDER, color: TEXT }}
            {...register('issuer')}
          />
          {errors.issuer && (
            <p className="mt-1 text-xs" style={{ color: '#dc2626' }}>{errors.issuer.message}</p>
          )}
        </div>

        {/* Expiration Required */}
        <div>
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border"
              style={{ accentColor: BLUE }}
              {...register('expirationRequired')}
            />
            <span className="text-sm font-medium" style={{ color: TEXT }}>
              Expiration date required for assignments
            </span>
          </label>
          <p className="mt-1.5 text-xs" style={{ color: SUB, marginLeft: 28 }}>
            When checked, employees must provide an expiration date when this certification is assigned.
            Changing this affects future assignments only.
          </p>
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
          onClick={() => router.push('/workforce/certifications')}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-100"
          style={{ color: SUB, borderColor: BORDER }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
