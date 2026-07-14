// Admin workspace domain types.
// Department types mirror DepartmentResponseDto from NestJS organization controller.
// tenantId intentionally absent — excluded per SEC-003.
// Reference: governance/GD-M25-1.md — Decisions 1, 2, 9

export type DepartmentStatus = 'ACTIVE' | 'INACTIVE';

export type DepartmentRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  status: DepartmentStatus;
  createdAt: string;
};

export type AdminDepartmentListApiResponse = {
  success: true;
  data: {
    departments: DepartmentRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

export type AdminDepartmentDetailApiResponse = {
  success: true;
  data: DepartmentRow;
};

export type CreateDepartmentBffResponse =
  | { success: true; data: DepartmentRow }
  | { success: false; error: { code: string; message: string } };

export type UpdateDepartmentBffResponse =
  | { success: true; data: DepartmentRow }
  | { success: false; error: { code: string; message: string } };

// ── User types ───────────────────────────────────────────────────────────────
// M25B read-only User Management (GD-M25-1 D3, D9).
// tenantId intentionally absent — excluded per SEC-003.

export type UserStatus = 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'DEACTIVATED';

export type UserRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: UserStatus;
  roles: string[];
  createdAt: string;
  lastLoginAt: string | null;
};

export type AdminUserListApiResponse = {
  success: true;
  data: {
    users: UserRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

export type AdminUserDetailApiResponse = {
  success: true;
  data: UserRow;
};

// ── Create User types — M26 (GD-M26-1 D4, D5) ────────────────────────────────
// RoleOption: id and name returned by GET /api/v1/roles.
// GetRolesApiResponse: shape from NestJS on success (serverFetch in Server Components).
// CreateUserBffResponse: union returned by POST /api/users BFF.
// tenantId intentionally absent — excluded per SEC-003.

export type RoleOption = { id: string; name: string };

export type GetRolesApiResponse = {
  success: true;
  data: { roles: RoleOption[] };
};

export type CreateUserBffResponse =
  | { success: true; data: UserRow }
  | { success: false; error: { code: string; message: string } };

// ── Update User types — M27 (GD-M27-1 D9) ────────────────────────────────────
// UpdateUserBffResponse: union returned by PATCH /api/users/[id] BFF.
// tenantId intentionally absent — excluded per SEC-003.

export type UpdateUserBffResponse =
  | { success: true; data: UserRow }
  | { success: false; error: { code: string; message: string } };
