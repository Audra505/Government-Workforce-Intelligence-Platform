'use client';

// Create User form — Client Component.
// POST /api/users → BFF → NestJS POST /api/v1/users.
// Roles received as props from the Server Component (fetched from GET /api/v1/roles).
// EMAIL_CONFLICT (409) and FORBIDDEN_ROLE_ASSIGNMENT (403) mapped to form-level banners.
// Password rules displayed as always-visible hint text (GD-M26-1 D5, D6).
// Reference: governance/GD-M26-1.md — Decisions 4, 5, 6, 7, 9

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { CreateUserBffResponse, RoleOption } from '@/features/admin/types';

// Mirrors PASSWORD_POLICY_REGEX from apps/api/src/identity/constants/password-policy.ts
const PASSWORD_POLICY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z\d\s])/;

const schema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName:  z.string().min(1, 'Last name is required'),
  email:     z.string().min(1, 'Email is required').email('Invalid email address'),
  roleIds:   z.array(z.string()).min(1, 'At least one role is required'),
  password:  z
    .string()
    .min(12, 'Password must be at least 12 characters')
    .regex(PASSWORD_POLICY_REGEX, 'Password must contain uppercase, lowercase, digit, and special character'),
});

type FormValues = z.infer<typeof schema>;

type Props = { roles: RoleOption[] };

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

export function CreateUserForm({ roles }: Props) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { roleIds: [] },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);

    let res: Response;
    try {
      res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: values.firstName,
          lastName:  values.lastName,
          email:     values.email,
          roleIds:   values.roleIds,
          password:  values.password,
        }),
      });
    } catch {
      setServerError('Unable to reach the server. Please try again.');
      return;
    }

    const json = (await res.json()) as CreateUserBffResponse;
    if (json.success) {
      router.push('/admin/users');
      router.refresh();
    } else {
      setServerError(SERVER_ERROR_MESSAGES[json.error.code] ?? json.error.message);
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
          <label className="mb-1.5 block text-sm font-medium" style={{ color: TEXT }} htmlFor="user-firstName">
            First Name <span style={{ color: ERROR }}>*</span>
          </label>
          <input
            id="user-firstName"
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
          <label className="mb-1.5 block text-sm font-medium" style={{ color: TEXT }} htmlFor="user-lastName">
            Last Name <span style={{ color: ERROR }}>*</span>
          </label>
          <input
            id="user-lastName"
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
          <label className="mb-1.5 block text-sm font-medium" style={{ color: TEXT }} htmlFor="user-email">
            Email <span style={{ color: ERROR }}>*</span>
          </label>
          <input
            id="user-email"
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
          <span className="mb-2 block text-sm font-medium" style={{ color: TEXT }} id="roles-label">
            Roles <span style={{ color: ERROR }}>*</span>
          </span>
          {roles.length === 0 ? (
            <p className="text-sm" style={{ color: ERROR }}>
              Unable to load roles. Please reload the page and try again.
            </p>
          ) : (
            <div
              role="group"
              aria-labelledby="roles-label"
              className="rounded-md border p-3"
              style={{ borderColor: errors.roleIds ? ERROR : BORDER }}
            >
              {roles.map((role) => (
                <label
                  key={role.id}
                  className="flex cursor-pointer items-center gap-2.5 py-1"
                >
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

        {/* Password */}
        <div>
          <label className="mb-1.5 block text-sm font-medium" style={{ color: TEXT }} htmlFor="user-password">
            Password <span style={{ color: ERROR }}>*</span>
          </label>
          <input
            id="user-password"
            type="password"
            autoComplete="new-password"
            className={INPUT_CLASS}
            style={{ borderColor: errors.password ? ERROR : BORDER, color: TEXT }}
            {...register('password')}
          />
          {errors.password ? (
            <p className="mt-1 text-xs" style={{ color: ERROR }}>{errors.password.message}</p>
          ) : (
            <p className="mt-1 text-xs" style={{ color: SUB }}>
              At least 12 characters. Must include uppercase, lowercase, digit, and one special character.
            </p>
          )}
        </div>
      </div>

      <div className="mt-8 flex items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting || roles.length === 0}
          className="rounded-md px-5 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-60"
          style={{ backgroundColor: BLUE }}
        >
          {isSubmitting ? 'Creating…' : 'Create User'}
        </button>
        <button
          type="button"
          onClick={() => router.push('/admin/users')}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-100"
          style={{ color: SUB, borderColor: BORDER }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
