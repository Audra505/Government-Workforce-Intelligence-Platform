// Create Position page — Server Component.
// Loads ACTIVE departments for the department selector; renders CreatePositionForm.
// Reference: directives/02_position_management_rules.md — POS-001, POS-AUTH-001
// Reference: governance/GD-PHASE2-CLOSURE-002.md — Decision 3

import Link from 'next/link';
import { serverFetch } from '@/lib/api';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
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
    <WorkforceShell activeTab="positions" breadcrumb="New Position">
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
    </WorkforceShell>
  );
}
