'use client';

// Create Employee form — React Hook Form + Zod.
// Calls BFF POST /api/employees (not NestJS directly — JWT is in httpOnly cookie).
// departmentId: select from ACTIVE departments passed as prop from Server Component.
// employeeNumber: required; immutable after creation per GD-M12-6 (EMP-304).
// tenantId is NOT in the form — derived from JWT by NestJS (SEC-003).
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-001, GD-M12-6, EMP-201 through EMP-204

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { DepartmentOption, CreateEmployeeBffResponse } from '@/features/workforce/types';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const schema = z.object({
  employeeNumber: z.string().min(1, 'Employee number is required').max(100, 'Employee number must be 100 characters or fewer'),
  firstName:      z.string().min(1, 'First name is required'),
  lastName:       z.string().min(1, 'Last name is required'),
  departmentId:   z.string().uuid('Please select a department'),
  email:          z.string().email('Please enter a valid email address').optional().or(z.literal('')),
  hireDate:       z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Error message map — keyed by NestJS error code
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  DEPARTMENT_NOT_FOUND:     'The selected department is no longer available. Please refresh and try again.',
  EMPLOYEE_NUMBER_CONFLICT: 'This employee number is already in use within your organization.',
  FORBIDDEN:                "You don't have permission to create employees.",
  UNAUTHORIZED:             'Session expired. Please sign in again.',
  VALIDATION_ERROR:         'Invalid form data. Please review your entries.',
  INTERNAL_ERROR:           'Service unavailable. Please try again.',
};

const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Props = { departments: DepartmentOption[] };

export function CreateEmployeeForm({ departments }: Props) {
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

    // Omit empty optional fields — empty string email treated as absent
    const body: Record<string, string> = {
      employeeNumber: values.employeeNumber,
      firstName:      values.firstName,
      lastName:       values.lastName,
      departmentId:   values.departmentId,
    };
    if (values.email)    body.email    = values.email;
    if (values.hireDate) body.hireDate = values.hireDate;

    try {
      const res = await fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.status === 201) {
        router.push('/workforce/employees');
        return;
      }

      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as CreateEmployeeBffResponse;
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

      {/* Employee Number — required; immutable after creation (GD-M12-6) */}
      <div className="space-y-2">
        <Label htmlFor="employeeNumber">
          Employee Number{' '}
          <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        <input
          id="employeeNumber"
          type="text"
          {...register('employeeNumber')}
          className={INPUT_CLASS}
          placeholder="e.g. EMP-001"
          aria-describedby={errors.employeeNumber ? 'employeeNumber-error' : undefined}
        />
        <p className="text-xs text-muted-foreground">
          Cannot be changed after the employee record is created.
        </p>
        {errors.employeeNumber && (
          <p id="employeeNumber-error" className="text-sm text-destructive">
            {errors.employeeNumber.message}
          </p>
        )}
      </div>

      {/* First Name */}
      <div className="space-y-2">
        <Label htmlFor="firstName">
          First Name{' '}
          <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        <input
          id="firstName"
          type="text"
          {...register('firstName')}
          className={INPUT_CLASS}
          aria-describedby={errors.firstName ? 'firstName-error' : undefined}
        />
        {errors.firstName && (
          <p id="firstName-error" className="text-sm text-destructive">
            {errors.firstName.message}
          </p>
        )}
      </div>

      {/* Last Name */}
      <div className="space-y-2">
        <Label htmlFor="lastName">
          Last Name{' '}
          <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        <input
          id="lastName"
          type="text"
          {...register('lastName')}
          className={INPUT_CLASS}
          aria-describedby={errors.lastName ? 'lastName-error' : undefined}
        />
        {errors.lastName && (
          <p id="lastName-error" className="text-sm text-destructive">
            {errors.lastName.message}
          </p>
        )}
      </div>

      {/* Department */}
      <div className="space-y-2">
        <Label htmlFor="departmentId">
          Department{' '}
          <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        {hasNoDepartments ? (
          <p className="text-sm text-muted-foreground">
            No active departments available. Create and activate a department before adding employees.
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
          <p id="departmentId-error" className="text-sm text-destructive">
            {errors.departmentId.message}
          </p>
        )}
      </div>

      {/* Email — optional (EMP-203) */}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <input
          id="email"
          type="email"
          {...register('email')}
          className={INPUT_CLASS}
          placeholder="employee@agency.gov"
          aria-describedby={errors.email ? 'email-error' : undefined}
        />
        {errors.email && (
          <p id="email-error" className="text-sm text-destructive">
            {errors.email.message}
          </p>
        )}
      </div>

      {/* Hire Date — optional (EMP-204) */}
      <div className="space-y-2">
        <Label htmlFor="hireDate">Hire Date</Label>
        <input
          id="hireDate"
          type="date"
          {...register('hireDate')}
          className={INPUT_CLASS}
          aria-describedby={errors.hireDate ? 'hireDate-error' : undefined}
        />
        {errors.hireDate && (
          <p id="hireDate-error" className="text-sm text-destructive">
            {errors.hireDate.message}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={isLoading || hasNoDepartments}>
          {isLoading ? 'Creating...' : 'Create Employee'}
        </Button>
        <Button asChild variant="outline">
          <Link href="/workforce/employees">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
