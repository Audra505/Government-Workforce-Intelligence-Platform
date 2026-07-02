// Edit Employee page — Server Component.
// Fetches employee by ID and ACTIVE departments; renders EditEmployeeForm.
// notFound() on 404 or 400 (employee not found, invalid UUID, or cross-tenant — SEC-003).
// EMP-302: SEPARATED employees cannot be edited — redirected to detail page in that case.
// Only SA + HR Director should reach this page; NestJS enforces RBAC on PUT submission (EMP-AUTH-004).
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-004, EMP-302, GD-M12-6, SEC-003

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { serverFetch, ApiError } from '@/lib/api';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { EditEmployeeForm } from '@/features/workforce/components/edit-employee-form';
import type { EmployeeDetailApiResponse, DepartmentListApiResponse } from '@/features/workforce/types';

type Props = {
  params: { id: string };
};

async function getActiveDepartments(): Promise<DepartmentListApiResponse> {
  return serverFetch<DepartmentListApiResponse>(
    '/api/v1/departments?status=ACTIVE&pageSize=100',
  );
}

export default async function EditEmployeePage({ params }: Props) {
  let response: EmployeeDetailApiResponse;

  try {
    response = await serverFetch<EmployeeDetailApiResponse>(`/api/v1/employees/${params.id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      notFound();
    }
    throw err;
  }

  const employee = response.data;

  // EMP-302: SEPARATED employees are read-only — redirect to detail page
  if (employee.employmentStatus === 'SEPARATED') {
    redirect(`/workforce/employees/${params.id}`);
  }

  const deptResponse = await getActiveDepartments();
  const departments = deptResponse.data.departments;

  return (
    <WorkforceShell activeTab="employees" breadcrumb={`${employee.firstName} ${employee.lastName}`}>
      <div className="mb-6">
        <Link
          href={`/workforce/employees/${employee.id}`}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to Employee
        </Link>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">
          Edit Employee — {employee.firstName} {employee.lastName}
        </h2>
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          {employee.employeeNumber}
        </p>
      </div>

      <div className="max-w-lg">
        <EditEmployeeForm employee={employee} departments={departments} />
      </div>
    </WorkforceShell>
  );
}
