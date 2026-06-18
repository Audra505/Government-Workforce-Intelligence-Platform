// Create Vacancy page — loads ACTIVE positions, renders CreateVacancyForm.
// Server Component: serverFetch reads JWT from cookie; throws ApiError on non-200.
// ApiError from getActivePositions() is caught by the co-located error.tsx boundary.
// Reference: spec/01_requirements.md — FR-103 Vacancy Management
// Reference: directives/03_vacancy_management_rules.md — VAC-100, VAC-101, VAC-102
// Reference: M11 Step 10 Governance — GD-10-3 (pageSize=100; search deferred)

import Link from 'next/link';
import { LogoutButton } from '@/features/auth/logout-button';
import { serverFetch } from '@/lib/api';
import { CreateVacancyForm } from '@/features/workforce/components/create-vacancy-form';
import type { PositionListApiResponse } from '@/features/workforce/types';

async function getActivePositions(): Promise<PositionListApiResponse> {
  return serverFetch<PositionListApiResponse>(
    '/api/v1/positions?status=ACTIVE&pageSize=100',
  );
}

export default async function NewVacancyPage() {
  const response = await getActivePositions();
  const positions = response.data.positions;

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
            href="/workforce/vacancies"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Back to Vacancies
          </Link>
          <h2 className="mt-2 text-2xl font-bold tracking-tight">Create Vacancy</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a new vacancy for an active position. Vacancies are created in Draft status.
          </p>
        </div>

        <div className="max-w-lg">
          <CreateVacancyForm positions={positions} />
        </div>
      </main>
    </div>
  );
}
