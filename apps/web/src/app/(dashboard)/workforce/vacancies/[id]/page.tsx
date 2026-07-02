// Vacancy detail page.
// Server Component: fetches GET /api/v1/vacancies/:id with JWT from session cookie.
// notFound() called on 404 — vacancy doesn't exist or belongs to another tenant (SEC-003).
// All other non-200 responses bubble to the route-level error.tsx.
// JWT payload decoded server-side to derive canWrite for Actions section (GD-12-4).
// Reference: spec/01_requirements.md — FR-103 Vacancy Management
// Reference: M11 Step 11 Governance — GD-11-1 (notFound for 404)
// Reference: M11 Step 12 Governance — GD-12-4 (role-based action visibility)

import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverFetch, ApiError } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { VacancyDetail } from '@/features/workforce/components/vacancy-detail';
import { VacancyActions } from '@/features/workforce/components/vacancy-actions';
import { SESSION_COOKIE } from '@/lib/auth';
import type { VacancyDetailApiResponse } from '@/features/workforce/types';

type Props = {
  params: { id: string };
};

export default async function VacancyDetailPage({ params }: Props) {
  let response: VacancyDetailApiResponse;

  try {
    response = await serverFetch<VacancyDetailApiResponse>(`/api/v1/vacancies/${params.id}`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) {
      // 404: vacancy not found; 400: invalid UUID in URL — both map to notFound (GD-11-1)
      notFound();
    }
    throw err; // 403, 5xx → error.tsx (transient or permissions error)
  }

  const vacancy = response.data;

  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite =
    roles.includes('System Administrator') || roles.includes('HR Director');

  return (
    <WorkforceShell activeTab="vacancies" breadcrumb={vacancy.positionTitle}>
      <div className="mb-6">
        <Link
          href="/workforce/vacancies"
          className="text-sm hover:underline"
          style={{ color: '#2563eb' }}
        >
          ← Vacancies
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{vacancy.positionTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{vacancy.departmentName}</p>
        </div>
        <VacancyActions id={vacancy.id} status={vacancy.status} canWrite={canWrite} />
      </div>

      <VacancyDetail vacancy={vacancy} />
    </WorkforceShell>
  );
}
