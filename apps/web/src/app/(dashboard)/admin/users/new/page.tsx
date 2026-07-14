// Create User page — Server Component.
// Fetches assignable roles from GET /api/v1/roles then passes them to the form.
// Role check: canWrite = SA + HRD only (GD-M26-1 D5).
// Reference: governance/GD-M26-1.md — Decisions 1, 5, 9

import { cookies } from 'next/headers';
import { getSessionRoles } from '@/lib/session';
import { SESSION_COOKIE } from '@/lib/auth';
import { serverFetch } from '@/lib/api';
import { AdminShell } from '@/features/admin/components/admin-shell';
import { CreateUserForm } from '@/features/admin/components/create-user-form';
import type { GetRolesApiResponse } from '@/features/admin/types';

export default async function NewUserPage() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const roles = token ? getSessionRoles(token) : [];
  const canWrite =
    roles.includes('System Administrator') || roles.includes('HR Director');

  if (!canWrite) {
    return (
      <AdminShell activeTab="users" breadcrumb="New User">
        <div className="flex min-h-[300px] items-center justify-center">
          <p className="text-sm" style={{ color: '#dc2626' }}>
            You do not have permission to create users.
          </p>
        </div>
      </AdminShell>
    );
  }

  const rolesData = await serverFetch<GetRolesApiResponse>('/api/v1/roles');

  return (
    <AdminShell activeTab="users" breadcrumb="New User">
      <div className="mx-auto max-w-lg">
        <h2 className="mb-6 text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
          Create User
        </h2>
        <CreateUserForm roles={rolesData.data.roles} />
      </div>
    </AdminShell>
  );
}
