// Create Employee page — Server Component.
// Fetches ACTIVE departments for the department selector.
// Renders CreateEmployeeForm (Client Component) with departments as prop.
// Only SA + HR Director should reach this page (canWrite gate on list page);
// NestJS enforces RBAC on form submission (EMP-AUTH-001).
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-001, GD-M12-6

import Link from 'next/link';
import { serverFetch } from '@/lib/api';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { CreateEmployeeForm } from '@/features/workforce/components/create-employee-form';
import type { DepartmentListApiResponse } from '@/features/workforce/types';

async function getActiveDepartments(): Promise<DepartmentListApiResponse> {
  return serverFetch<DepartmentListApiResponse>(
    '/api/v1/departments?status=ACTIVE&pageSize=100',
  );
}

export default async function NewEmployeePage() {
  const response = await getActiveDepartments();
  const departments = response.data.departments;

  return (
    <WorkforceShell activeTab="employees" breadcrumb="New Employee">
      <div className="mb-6">
        <Link
          href="/workforce/employees"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← Back to Employees
        </Link>
        <h2 className="mt-2 text-2xl font-bold tracking-tight">Create Employee</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a new employee record. The employee number cannot be changed after creation.
        </p>
      </div>

      <div className="max-w-lg">
        <CreateEmployeeForm departments={departments} />
      </div>
    </WorkforceShell>
  );
}
