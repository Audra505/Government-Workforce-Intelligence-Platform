// Create Employee page — Server Component.
// Fetches ACTIVE departments for the department selector.
// Renders CreateEmployeeForm (Client Component) with departments as prop.
// Only SA + HR Director should reach this page (canWrite gate on list page);
// NestJS enforces RBAC on form submission (EMP-AUTH-001).
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-001, GD-M12-6

import Link from 'next/link';
import { LogoutButton } from '@/features/auth/logout-button';
import { serverFetch } from '@/lib/api';
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
    <div className="flex min-h-screen flex-col">
      <header className="border-b bg-background px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">
            Government Workforce Intelligence Platform
          </h1>
          <LogoutButton />
        </div>
      </header>

      <main className="flex-1 p-6">
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
      </main>
    </div>
  );
}
