// Employee detail page — Server Component.
// Fetches GET /api/v1/employees/:id with JWT from session cookie.
// notFound() called on 404 or 400 — employee not found or invalid UUID (GD-11-1 established).
// canWrite from JWT roles — gates Edit, EmployeeStatusActions, EmployeePositionActions (GD-M12-S4-1).
// EMP-302: SEPARATED employees → no edit or status or position actions shown.
// Active positions fetched for the assignment selector (parallel with employee fetch; errors caught).
// M24C: Skills + certifications assignments and catalogs fetched non-fatally.
//   If any fetch fails (e.g. 403, network error), EmployeeDetail degrades gracefully per section.
// Current position title resolved via secondary fetch when positionId is set; title may be null
//   if the position was deleted or if the caller's role cannot read it — EmployeeDetail degrades gracefully.
// Reference: directives/13_employee_management_rules.md — EMP-AUTH-003, EMP-302, RBAC-952
// Reference: governance/GD-M15-1.md — Decision 5, 6, 10
// Reference: governance/GD-M24-1.md — Decisions 3, 6, 7

import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverFetch, ApiError } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { WorkforceShell } from '@/features/workforce/components/workforce-shell';
import { Button } from '@/components/ui/button';
import { EmployeeDetail } from '@/features/workforce/components/employee-detail';
import { EmployeeStatusActions } from '@/features/workforce/components/employee-status-actions';
import { EmployeePositionActions } from '@/features/workforce/components/employee-position-actions';
import { SESSION_COOKIE } from '@/lib/auth';
import type {
  EmployeeDetailApiResponse,
  PositionFullListApiResponse,
  PositionDetailApiResponse,
  PositionOption,
  EmployeeSkillListApiResponse,
  EmployeeCertificationListApiResponse,
  SkillListApiResponse,
  CertificationListApiResponse,
  SkillRow,
  CertificationRow,
  EmployeeSkillAssignment,
  EmployeeCertificationAssignment,
} from '@/features/workforce/types';

type Props = {
  params: { id: string };
};

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

  // All secondary fetches are non-fatal — network failures or RBAC blocks degrade gracefully.
  // M24C: employee skills/certs and catalog lists added in parallel (6 total non-fatal fetches).
  const [
    activePositionsRes,
    currentPositionRes,
    employeeSkillsRes,
    employeeCertsRes,
    skillsCatalogRes,
    certsCatalogRes,
  ] = await Promise.all([
    serverFetch<PositionFullListApiResponse>('/api/v1/positions?status=ACTIVE&pageSize=100')
      .catch(() => null),
    employee.positionId
      ? serverFetch<PositionDetailApiResponse>(`/api/v1/positions/${employee.positionId}`)
          .catch(() => null)
      : Promise.resolve(null),
    serverFetch<EmployeeSkillListApiResponse>(`/api/v1/employees/${params.id}/skills`)
      .catch(() => null),
    serverFetch<EmployeeCertificationListApiResponse>(`/api/v1/employees/${params.id}/certifications`)
      .catch(() => null),
    serverFetch<SkillListApiResponse>('/api/v1/skills?pageSize=100')
      .catch(() => null),
    serverFetch<CertificationListApiResponse>('/api/v1/certifications?pageSize=100')
      .catch(() => null),
  ]);

  const activePositions: PositionOption[] =
    activePositionsRes?.data.positions ?? [];
  const currentPositionTitle: string | null =
    currentPositionRes?.data.title ?? null;

  // null = fetch failed (section degrades gracefully); [] = success with no data
  const employeeSkills: EmployeeSkillAssignment[] | null =
    employeeSkillsRes ? (employeeSkillsRes.data.skills ?? []) : null;
  const employeeCertifications: EmployeeCertificationAssignment[] | null =
    employeeCertsRes ? (employeeCertsRes.data.certifications ?? []) : null;
  const skillsCatalog: SkillRow[] | null =
    skillsCatalogRes ? (skillsCatalogRes.data.skills ?? []) : null;
  const certificationsCatalog: CertificationRow[] | null =
    certsCatalogRes ? (certsCatalogRes.data.certifications ?? []) : null;

  return (
    <WorkforceShell activeTab="employees" breadcrumb={`${employee.firstName} ${employee.lastName}`}>
      <div className="mb-6">
        <Link
          href="/workforce/employees"
          className="text-sm hover:underline"
          style={{ color: '#2563eb' }}
        >
          ← Employees
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {employee.firstName} {employee.lastName}
          </h2>
          <p
            className="mt-1 text-sm"
            style={{
              fontFamily: "var(--font-ibm-plex-mono, 'IBM Plex Mono', monospace)",
              fontSize: 12,
              color: '#94a3b8',
            }}
          >
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

      <EmployeeDetail
        employee={employee}
        currentPositionTitle={currentPositionTitle}
        employeeSkills={employeeSkills}
        employeeCertifications={employeeCertifications}
        skillsCatalog={skillsCatalog}
        certificationsCatalog={certificationsCatalog}
        canWrite={canWrite}
      />
    </WorkforceShell>
  );
}
