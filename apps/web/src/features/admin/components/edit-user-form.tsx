'use client';

// Edit User form — Client Component.
// PATCH /api/users/[id] → BFF → NestJS PATCH /api/v1/users/:id.
// Roles received from Server Component (fetched from GET /api/v1/roles, filtered by actor).
// defaultRoleIds: current user roles mapped from names to IDs by the server component.
// Status changes are handled separately by UserStatusActions on the detail page (D11).
// Reference: governance/GD-M27-1.md — Decisions 3, 7, 9, 10, 12

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { RoleOption, UpdateUserBffResponse } from '@/features/admin/types';

const schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName:  z.string().min(1, 'Last name is required'),
  email:     z.string().min(1, 'Email is required').email('Invalid email address'),
  roleIds:   z.array(z.string()).min(1, 'At least one role must be selected'),
});

type FormValues = z.infer<typeof schema>;

type Props = {
  userId: string;
  roles: RoleOption[];
  defaultValues: {
    firstName: string;
    lastName: string;
    email: string;
    roleIds: string[];
  };
};

const SERVER_ERROR_MESSAGES: Record<string, string> = {
  CONFLICT:                  'A user with this email address already exists in this tenant.',
  FORBIDDEN_ROLE_ASSIGNMENT: 'You do not have permission to assign one or more of the selected roles.',
  ROLE_NOT_FOUND:            'One or more selected roles could not be found. Please reload and try again.',
};

const INPUT_CLASS =
  'block w-full rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20';

const BLUE   = '#2563eb';
const TEXT   = '#0f172a';
const SUB    = '#475569';
const BORDER = '#e2e8f0';
const ERROR  = '#dc2626';

export function EditUserForm({ userId, roles, defaultValues }: Props) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });

  const selectedRoleIds = watch('roleIds');

  async function onSubmit(values: FormValues) {
    setServerError(null);

    let res: Response;
    try {
      res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: values.firstName,
          lastName:  values.lastName,
          email:     values.email,
          roleIds:   values.roleIds,
        }),
      });
    } catch {
      setServerError('Unable to reach the server. Please check your connection and try again.');
      return;
    }

    const json = (await res.json()) as UpdateUserBffResponse;
    if (json.success) {
      router.push(`/admin/users/${userId}`);
      router.refresh();
    } else {
      setServerError(
        SERVER_ERROR_MESSAGES[json.error.code] ??
          json.error.message ??
          'An unexpected error occurred. Please try again.',
      );
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      {serverError && (
        <div
          className="mb-6 rounded-md border px-4 py-3 text-sm"
          style={{ borderColor: '#fca5a5', backgroundColor: '#fef2f2', color: ERROR }}
          role="alert"
        >
          {serverError}
        </div>
      )}

      <div className="space-y-5">
        {/* First Name */}
        <div>
          <label
            className="mb-1.5 block text-sm font-medium"
            style={{ color: TEXT }}
            htmlFor="edit-firstName"
          >
            First Name <span style={{ color: ERROR }}>*</span>
          </label>
          <input
            id="edit-firstName"
            type="text"
            autoComplete="given-name"
            className={INPUT_CLASS}
            style={{ borderColor: errors.firstName ? ERROR : BORDER, color: TEXT }}
            {...register('firstName')}
          />
          {errors.firstName && (
            <p className="mt-1 text-xs" style={{ color: ERROR }}>{errors.firstName.message}</p>
          )}
        </div>

        {/* Last Name */}
        <div>
          <label
            className="mb-1.5 block text-sm font-medium"
            style={{ color: TEXT }}
            htmlFor="edit-lastName"
          >
            Last Name <span style={{ color: ERROR }}>*</span>
          </label>
          <input
            id="edit-lastName"
            type="text"
            autoComplete="family-name"
            className={INPUT_CLASS}
            style={{ borderColor: errors.lastName ? ERROR : BORDER, color: TEXT }}
            {...register('lastName')}
          />
          {errors.lastName && (
            <p className="mt-1 text-xs" style={{ color: ERROR }}>{errors.lastName.message}</p>
          )}
        </div>

        {/* Email */}
        <div>
          <label
            className="mb-1.5 block text-sm font-medium"
            style={{ color: TEXT }}
            htmlFor="edit-email"
          >
            Email <span style={{ color: ERROR }}>*</span>
          </label>
          <input
            id="edit-email"
            type="email"
            autoComplete="email"
            className={INPUT_CLASS}
            style={{ borderColor: errors.email ? ERROR : BORDER, color: TEXT }}
            {...register('email')}
          />
          {errors.email && (
            <p className="mt-1 text-xs" style={{ color: ERROR }}>{errors.email.message}</p>
          )}
        </div>

        {/* Roles */}
        <div>
          <span
            className="mb-2 block text-sm font-medium"
            style={{ color: TEXT }}
            id="edit-roles-label"
          >
            Roles <span style={{ color: ERROR }}>*</span>
          </span>
          {roles.length === 0 ? (
            <p className="text-sm" style={{ color: ERROR }}>
              Unable to load roles. Please reload the page and try again.
            </p>
          ) : (
            <div
              role="group"
              aria-labelledby="edit-roles-label"
              className="rounded-md border p-3"
              style={{ borderColor: errors.roleIds ? ERROR : BORDER }}
            >
              {roles.map((role) => (
                <label key={role.id} className="flex cursor-pointer items-center gap-2.5 py-1">
                  <input
                    type="checkbox"
                    value={role.id}
                    className="h-4 w-4 rounded border"
                    style={{ accentColor: BLUE }}
                    {...register('roleIds')}
                  />
                  <span className="text-sm" style={{ color: TEXT }}>
                    {role.name}
                  </span>
                </label>
              ))}
            </div>
          )}
          {errors.roleIds && (
            <p className="mt-1 text-xs" style={{ color: ERROR }}>{errors.roleIds.message}</p>
          )}
        </div>
      </div>

      <div className="mt-8 flex items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting || selectedRoleIds.length === 0}
          className="rounded-md px-5 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-60"
          style={{ backgroundColor: BLUE }}
        >
          {isSubmitting ? 'Saving…' : 'Save Changes'}
        </button>
        <button
          type="button"
          onClick={() => router.push(`/admin/users/${userId}`)}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-100"
          style={{ color: SUB, borderColor: BORDER }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
