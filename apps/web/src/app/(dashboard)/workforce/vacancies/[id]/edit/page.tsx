// Edit Vacancy page.
// Server Component: fetches current vacancy data for form pre-population.
// CLOSED vacancies redirect to detail page — editing is blocked by service (VAC-501, GD-12-7).
// notFound() on 404/400 consistent with sibling detail page (GD-11-1).
// Reference: directives/03_vacancy_management_rules.md — VAC-501 (CLOSED read-only)
// Reference: M11 Step 12 Governance — GD-12-1 (separate route), GD-12-7 (CLOSED redirect)

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { LogoutButton } from '@/features/auth/logout-button';
import { serverFetch, ApiError } from '@/lib/api';
import { EditVacancyForm } from '@/features/workforce/components/edit-vacancy-form';
import type { VacancyDetailApiResponse } from '@/features/workforce/types';

type Props = {
  params: { id: string };
};

export default async function EditVacancyPage({ params }: Props) {
  let response: VacancyDetailApiResponse;

  try {
    response = await serverFetch<VacancyDetailApiResponse>(`/api/v1/vacancies/${params.id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      notFound();
    }
    throw err; // 403, 5xx → error.tsx
  }

  const vacancy = response.data;

  // CLOSED vacancies are read-only — redirect to detail page (GD-12-7)
  if (vacancy.status === 'CLOSED') {
    redirect(`/workforce/vacancies/${params.id}`);
  }

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
            href={`/workforce/vacancies/${params.id}`}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back to Vacancy
          </Link>
        </div>

        <div className="mb-6">
          <h2 className="text-2xl font-bold tracking-tight">{vacancy.positionTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{vacancy.departmentName}</p>
        </div>

        <div className="max-w-lg">
          <h3 className="mb-4 text-base font-semibold">Edit Vacancy</h3>
          <EditVacancyForm vacancy={vacancy} />
        </div>
      </main>
    </div>
  );
}
