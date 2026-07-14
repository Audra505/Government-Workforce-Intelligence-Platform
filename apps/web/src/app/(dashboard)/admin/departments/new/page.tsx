// Create Department page — Server Component.
// Role check: canWrite = SA + HRD only (GD-M25-1 D5).
// Reference: governance/GD-M25-1.md — Decisions 2, 5, 12

import { cookies } from 'next/headers';
import { getSessionRoles } from '@/lib/session';
import { SESSION_COOKIE } from '@/lib/auth';
import { AdminShell } from '@/features/admin/components/admin-shell';
import { CreateDepartmentForm } from '@/features/admin/components/create-department-form';

export default function NewDepartmentPage() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite =
    roles.includes('System Administrator') || roles.includes('HR Director');

  if (!canWrite) {
    return (
      <AdminShell activeTab="departments" breadcrumb="New Department">
        <div className="flex min-h-[300px] items-center justify-center">
          <p className="text-sm" style={{ color: '#dc2626' }}>
            You do not have permission to create departments.
          </p>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell activeTab="departments" breadcrumb="New Department">
      <div className="mx-auto max-w-lg">
        <h2 className="mb-6 text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
          Create Department
        </h2>
        <CreateDepartmentForm />
      </div>
    </AdminShell>
  );
}
