// Edit Department page — Server Component.
// Fetches department for pre-fill, then renders EditDepartmentForm.
// Role check: canWrite = SA + HRD only (GD-M25-1 D5).
// Reference: governance/GD-M25-1.md — Decisions 2, 5, 12

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverFetch, ApiError } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { SESSION_COOKIE } from '@/lib/auth';
import { AdminShell } from '@/features/admin/components/admin-shell';
import { EditDepartmentForm } from '@/features/admin/components/edit-department-form';
import type { AdminDepartmentDetailApiResponse } from '@/features/admin/types';

type Props = { params: { id: string } };

export default async function EditDepartmentPage({ params }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite =
    roles.includes('System Administrator') || roles.includes('HR Director');

  if (!canWrite) {
    return (
      <AdminShell activeTab="departments" breadcrumb="Edit Department">
        <div className="flex min-h-[300px] items-center justify-center">
          <p className="text-sm" style={{ color: '#dc2626' }}>
            You do not have permission to edit departments.
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
    <AdminShell activeTab="departments" breadcrumb={`Edit ${dept.name}`}>
      <div className="mx-auto max-w-lg">
        <h2 className="mb-6 text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
          Edit Department
        </h2>
        <EditDepartmentForm department={dept} />
      </div>
    </AdminShell>
  );
}
