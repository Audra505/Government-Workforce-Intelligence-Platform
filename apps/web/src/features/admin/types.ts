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
