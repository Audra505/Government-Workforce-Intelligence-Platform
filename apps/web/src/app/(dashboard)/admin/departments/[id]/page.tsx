// Department detail page — Server Component.
// Fetches GET /api/v1/departments/:id with JWT from session cookie.
// Edit button: canWrite = SA + HRD.
// Deactivate section: canWrite && dept.status === 'ACTIVE'.
// Reference: governance/GD-M25-1.md — Decisions 2, 5, 8, 9, 12

import Link from 'next/link';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverFetch, ApiError } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { SESSION_COOKIE } from '@/lib/auth';
import { AdminShell } from '@/features/admin/components/admin-shell';
import { StatusPill } from '@/components/shared/status-pill';
import { DeactivateDepartment } from '@/features/admin/components/deactivate-department';
import type { AdminDepartmentDetailApiResponse } from '@/features/admin/types';
import type { StatusPillColor } from '@/components/shared/status-pill';

const STATUS_COLOR: Record<string, StatusPillColor> = {
  ACTIVE:   'green',
  INACTIVE: 'gray',
};

const BLUE   = '#2563eb';
const TEXT   = '#0f172a';
const SUB    = '#475569';
const BORDER = '#e2e8f0';

type Props = { params: { id: string } };

export default async function DepartmentDetailPage({ params }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];

  const canRead =
    roles.includes('System Administrator') ||
    roles.includes('HR Director') ||
    roles.includes('Workforce Planner');
  const canWrite =
    roles.includes('System Administrator') || roles.includes('HR Director');

  if (!canRead) {
    return (
      <AdminShell activeTab="departments" breadcrumb="Department">
        <div className="flex min-h-[300px] items-center justify-center">
          <p className="text-sm" style={{ color: '#dc2626' }}>
            You do not have permission to view this department.
          </p>
        </div>
      </AdminShell>
    );
  }

  let response: AdminDepartmentDetailApiResponse;
  try {
    response = await serverFetch<AdminDepartmentDetailApiResponse>(
      `/api/v1/departments/${params.id}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      notFound();
    }
    throw err;
  }

  const dept = response.data;

  return (
    <AdminShell activeTab="departments" breadcrumb={dept.name}>
      <div className="mx-auto max-w-2xl">
        {/* Header row */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight" style={{ color: TEXT }}>
              {dept.name}
            </h2>
            <p className="mt-1 text-xs font-mono" style={{ color: SUB }}>{dept.code}</p>
          </div>
          <div className="flex items-center gap-3">
            <StatusPill color={STATUS_COLOR[dept.status] ?? 'gray'} label={dept.status} />
            {canWrite && (
              <Link
                href={`/admin/departments/${dept.id}/edit`}
                className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
                style={{ color: BLUE, borderColor: BORDER }}
              >
                Edit
              </Link>
            )}
          </div>
        </div>

        {/* Detail card */}
        <div
          className="rounded-lg border p-5"
          style={{ borderColor: BORDER }}
        >
          <dl className="space-y-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#94a3b8', letterSpacing: '0.09em' }}>
                Description
              </dt>
              <dd className="mt-1 text-sm" style={{ color: dept.description ? TEXT : SUB }}>
                {dept.description ?? 'No description provided.'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#94a3b8', letterSpacing: '0.09em' }}>
                Status
              </dt>
              <dd className="mt-1">
                <StatusPill color={STATUS_COLOR[dept.status] ?? 'gray'} label={dept.status} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wider" style={{ color: '#94a3b8', letterSpacing: '0.09em' }}>
                Created
              </dt>
              <dd className="mt-1 text-sm" style={{ color: SUB }}>
                {new Date(dept.createdAt).toLocaleDateString(undefined, {
                  year: 'numeric', month: 'long', day: 'numeric',
                })}
              </dd>
            </div>
          </dl>
        </div>

        {/* Deactivate section — visible only to canWrite and only when ACTIVE */}
        {canWrite && dept.status === 'ACTIVE' && (
          <DeactivateDepartment departmentId={dept.id} departmentName={dept.name} />
        )}
      </div>
    </AdminShell>
  );
}
