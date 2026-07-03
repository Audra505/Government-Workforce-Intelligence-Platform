'use client';

// Edit Employee form — React Hook Form + Zod.
// Calls BFF PUT /api/employees/:id (not NestJS directly — JWT is in httpOnly cookie).
// EMP-304/GD-M12-6: employeeNumber is ABSENT from this form entirely — immutable after creation.
// EMP-302: edit page rendered only for non-SEPARATED employees (enforced in parent page).
// All fields optional: partial update — omitted fields unchanged on the server.
// tenantId is NOT in the form — derived from JWT by NestJS (SEC-003).
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-004, GD-M12-6, EMP-302, EMP-304

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { EmployeeRow, DepartmentOption, UpdateEmployeeBffResponse } from '@/features/workforce/types';

// ---------------------------------------------------------------------------
// Zod schema — all optional; partial update
// employeeNumber intentionally absent (EMP-304/GD-M12-6)
// ---------------------------------------------------------------------------

const schema = z.object({
  firstName:    z.string().min(1, 'First name cannot be empty').optional().or(z.literal('')),
  lastName:     z.string().min(1, 'Last name cannot be empty').optional().or(z.literal('')),
  email:        z.string().email('Please enter a valid email address').optional().or(z.literal('')),
  departmentId: z.string().uuid('Please select a department').optional().or(z.literal('')),
  hireDate:     z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Error message map
// ---------------------------------------------------------------------------

const ERROR_MESSAGES: Record<string, string> = {
  EMPLOYEE_NUMBER_IMMUTABLE: 'Employee number cannot be changed after creation.',
  EMPLOYEE_IS_SEPARATED:     'This employee is separated and cannot be modified.',
  DEPARTMENT_NOT_FOUND:      'The selected department is no longer available. Please refresh and try again.',
  NOT_FOUND:                 'This employee record could not be found.',
  FORBIDDEN:                 "You don't have permission to edit employees.",
  UNAUTHORIZED:              'Session expired. Please sign in again.',
  VALIDATION_ERROR:          'Invalid form data. Please review your entries.',
  INTERNAL_ERROR:            'Service unavailable. Please try again.',
};

const INPUT_CLASS =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  return iso.substring(0, 10);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Props = {
  employee: EmployeeRow;
  departments: DepartmentOption[];
};

export function EditEmployeeForm({ employee, departments }: Props) {
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
      firstName:    employee.firstName,
      lastName:     employee.lastName,
      email:        employee.email ?? '',
      departmentId: employee.departmentId,
      hireDate:     toDateInputValue(employee.hireDate),
    },
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    setIsLoading(true);

    // Only include non-empty changed fields — undefined/empty means "no change"
    const body: Record<string, string> = {};
    if (values.firstName)    body.firstName    = values.firstName;
    if (values.lastName)     body.lastName     = values.lastName;
    if (values.email)        body.email        = values.email;
    if (values.departmentId) body.departmentId = values.departmentId;
    if (values.hireDate)     body.hireDate     = values.hireDate;

    try {
      const res = await fetch(`/api/employees/${employee.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        router.push(`/workforce/employees/${employee.id}`);
        router.refresh();
        return;
      }

      let errorCode = 'INTERNAL_ERROR';
      try {
        const data = (await res.json()) as UpdateEmployeeBffResponse;
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

      {/* Employee Number — display only; not editable (EMP-304/GD-M12-6) */}
      <div className="space-y-1 rounded-md border bg-muted/30 px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Employee Number (read-only)
        </p>
        <p className="font-mono text-sm">{employee.employeeNumber}</p>
      </div>

      {/* First Name */}
      <div className="space-y-2">
        <Label htmlFor="firstName">First Name</Label>
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
        <Label htmlFor="lastName">Last Name</Label>
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
        <Label htmlFor="departmentId">Department</Label>
        <select
          id="departmentId"
          {...register('departmentId')}
          className={INPUT_CLASS}
          aria-describedby={errors.departmentId ? 'departmentId-error' : undefined}
        >
          <option value="">No change</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.code})
            </option>
          ))}
        </select>
        {errors.departmentId && (
          <p id="departmentId-error" className="text-sm text-destructive">
            {errors.departmentId.message}
          </p>
        )}
      </div>

      {/* Email */}
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

      {/* Hire Date */}
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
        <Button type="submit" size="sm" style={{ backgroundColor: '#2563eb' }} disabled={isLoading}>
          {isLoading ? 'Saving…' : 'Save Changes'}
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/workforce/employees/${employee.id}`}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
