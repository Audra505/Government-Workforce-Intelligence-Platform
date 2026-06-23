// Employee detail page — Server Component.
// Fetches GET /api/v1/employees/:id with JWT from session cookie.
// notFound() called on 404 or 400 — employee not found or invalid UUID (GD-11-1 established).
// canWrite from JWT roles — gates Edit, EmployeeStatusActions, EmployeePositionActions (GD-M12-S4-1).
// EMP-302: SEPARATED employees → no edit or status or position actions shown.
// Active positions fetched for the assignment selector (parallel with employee fetch; errors caught).
// Current position title resolved via secondary fetch when positionId is set; title may be null
//   if the position was deleted or if the caller's role cannot read it — EmployeeDetail degrades gracefully.
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-003, EMP-302, RBAC-952
// Reference: governance/GD-M15-1.md — Decision 5, 6, 10

import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { LogoutButton } from '@/features/auth/logout-button';
import { Button } from '@/components/ui/button';
import { serverFetch, ApiError } from '@/lib/api';
import { EmployeeDetail } from '@/features/workforce/components/employee-detail';
import { EmployeeStatusActions } from '@/features/workforce/components/employee-status-actions';
import { EmployeePositionActions } from '@/features/workforce/components/employee-position-actions';
import { SESSION_COOKIE } from '@/lib/auth';
import type {
  EmployeeDetailApiResponse,
  PositionFullListApiResponse,
  PositionDetailApiResponse,
  PositionOption,
} from '@/features/workforce/types';

type Props = {
  params: { id: string };
};

function getSessionRoles(token: string): string[] {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { roles?: unknown };
    return Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
  } catch {
    return [];
  }
}

export default async function EmployeeDetailPage({ params }: Props) {
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
  const isSeparated = employee.employmentStatus === 'SEPARATED';

  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite =
    roles.includes('System Administrator') || roles.includes('HR Director');

  // Fetch active positions for the assignment selector and resolve current position title.
  // Both fetches are non-fatal: network failures or RBAC blocks degrade gracefully.
  const [activePositionsRes, currentPositionRes] = await Promise.all([
    serverFetch<PositionFullListApiResponse>('/api/v1/positions?status=ACTIVE&pageSize=100')
      .catch(() => null),
    employee.positionId
      ? serverFetch<PositionDetailApiResponse>(`/api/v1/positions/${employee.positionId}`)
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const activePositions: PositionOption[] =
    activePositionsRes?.data.positions ?? [];
  const currentPositionTitle: string | null =
    currentPositionRes?.data.title ?? null;

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
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back to Employees
          </Link>
        </div>

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              {employee.firstName} {employee.lastName}
            </h2>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {employee.employeeNumber}
            </p>
          </div>

          {/* Actions — EMP-302: hidden entirely for SEPARATED employees */}
          {!isSeparated && canWrite && (
            <div className="flex items-center gap-3">
              <Button asChild variant="outline" size="sm">
                <Link href={`/workforce/employees/${employee.id}/edit`}>Edit</Link>
              </Button>
              <span className="h-4 w-px bg-border" aria-hidden="true" />
              <EmployeeStatusActions
                id={employee.id}
                currentStatus={employee.employmentStatus}
                canWrite={canWrite}
              />
              <span className="h-4 w-px bg-border" aria-hidden="true" />
              <EmployeePositionActions
                employeeId={employee.id}
                positionId={employee.positionId}
                employmentStatus={employee.employmentStatus}
                canWrite={canWrite}
                activePositions={activePositions}
              />
            </div>
          )}
        </div>

        <EmployeeDetail employee={employee} currentPositionTitle={currentPositionTitle} />
      </main>
    </div>
  );
}
