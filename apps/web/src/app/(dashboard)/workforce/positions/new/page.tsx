// Create Position page — Server Component.
// Loads ACTIVE departments for the department selector; renders CreatePositionForm.
// Reference: directives/02_position_management_rules.md — POS-001, POS-AUTH-001
// Reference: governance/GD-PHASE2-CLOSURE-002.md — Decision 3

import Link from 'next/link';
import { LogoutButton } from '@/features/auth/logout-button';
import { serverFetch } from '@/lib/api';
import { CreatePositionForm } from '@/features/workforce/components/create-position-form';
import type { DepartmentListApiResponse } from '@/features/workforce/types';

async function getActiveDepartments(): Promise<DepartmentListApiResponse> {
  return serverFetch<DepartmentListApiResponse>(
    '/api/v1/departments?status=ACTIVE&pageSize=100',
  );
}

export default async function NewPositionPage() {
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
            href="/workforce/positions"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Back to Positions
          </Link>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">Create Position</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Positions are created in Draft status. Activate the position when it is ready for assignment.
          </p>
        </div>

        <div className="max-w-lg">
          <CreatePositionForm departments={departments} />
        </div>
      </main>
    </div>
  );
}
