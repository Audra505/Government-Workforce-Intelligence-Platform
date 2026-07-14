// Edit User page — Server Component.
// Fetches user for pre-fill and roles for role selector, then renders EditUserForm.
// Role check: canEdit = SA + HRD only (GD-M27-1 D10).
// HRD defense-in-depth: renders restriction message if target user is SA (D6 / D10).
// Role map: maps current user role names → role IDs for pre-selection (D7).
// Reference: governance/GD-M27-1.md — Decisions 6, 7, 10, 12

import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { serverFetch, ApiError } from '@/lib/api';
import { getSessionRoles } from '@/lib/session';
import { SESSION_COOKIE } from '@/lib/auth';
import { AdminShell } from '@/features/admin/components/admin-shell';
import { EditUserForm } from '@/features/admin/components/edit-user-form';
import type { AdminUserDetailApiResponse, GetRolesApiResponse } from '@/features/admin/types';

type Props = { params: { id: string } };

export default async function EditUserPage({ params }: Props) {
  const token = cookies().get(SESSION_COOKIE)?.value;
  const actorRoles = token ? getSessionRoles(token) : [];
  const isSA  = actorRoles.includes('System Administrator');
  const isHRD = actorRoles.includes('HR Director');
  const canEdit = isSA || isHRD;

  if (!canEdit) {
    return (
      <AdminShell activeTab="users" breadcrumb="Edit User">
        <div className="flex min-h-[300px] items-center justify-center">
          <p className="text-sm" style={{ color: '#dc2626' }}>
            You do not have permission to edit users.
          </p>
        </div>
      </AdminShell>
    );
  }

  let userResponse: AdminUserDetailApiResponse;
  try {
    userResponse = await serverFetch<AdminUserDetailApiResponse>(`/api/v1/users/${params.id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const user = userResponse.data;

  // HRD cannot edit SA users — defense-in-depth (backend is authoritative)
  if (isHRD && !isSA && user.roles.includes('System Administrator')) {
    return (
      <AdminShell activeTab="users" breadcrumb="Edit User">
        <div className="flex min-h-[300px] items-center justify-center">
          <p className="text-sm" style={{ color: '#dc2626' }}>
            HR Directors cannot edit System Administrator accounts.
          </p>
        </div>
      </AdminShell>
    );
  }

  const rolesData = await serverFetch<GetRolesApiResponse>('/api/v1/roles');
  const roles = rolesData.data.roles;

  // Map current role names to IDs for pre-selection (D7 role discovery)
  const roleMap = new Map(roles.map((r) => [r.name, r.id]));
  const defaultRoleIds = user.roles
    .map((name) => roleMap.get(name))
    .filter((id): id is string => id !== undefined);

  const fullName = `${user.firstName} ${user.lastName}`;

  return (
    <AdminShell activeTab="users" breadcrumb={`Edit ${fullName}`}>
      <div className="mx-auto max-w-lg">
        <h2 className="mb-6 text-xl font-bold tracking-tight" style={{ color: '#0f172a' }}>
          Edit User
        </h2>
        <EditUserForm
          userId={params.id}
          roles={roles}
          defaultValues={{
            firstName: user.firstName,
            lastName:  user.lastName,
            email:     user.email,
            roleIds:   defaultRoleIds,
          }}
        />
      </div>
    </AdminShell>
  );
}
