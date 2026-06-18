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
import { LogoutButton } from '@/features/auth/logout-button';
import { serverFetch, ApiError } from '@/lib/api';
import { VacancyDetail } from '@/features/workforce/components/vacancy-detail';
import { VacancyActions } from '@/features/workforce/components/vacancy-actions';
import { SESSION_COOKIE } from '@/lib/auth';
import type { VacancyDetailApiResponse } from '@/features/workforce/types';

type Props = {
  params: { id: string };
};

// Decode JWT payload without signature verification — server-side only.
// Used for UX (show/hide write actions). NestJS is the authoritative RBAC enforcer.
function getSessionRoles(token: string): string[] {
  try {
    // JWT payload is URL-safe base64 — convert to standard base64 before atob
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { roles?: unknown };
    return Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
  } catch {
    return [];
  }
}

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

  // Decode session roles for action visibility (GD-12-4 modified approval)
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite =
    roles.includes('System Administrator') || roles.includes('HR Director');

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
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back to Vacancies
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
      </main>
    </div>
  );
}
