// Vacancy domain types for the frontend.
// These mirror the VacancyResponseDto shape returned by GET /api/v1/vacancies.
// tenantId is intentionally absent — excluded by the API per SEC-003.
// Reference: apps/api/src/workforce/dto/vacancy-response.dto.ts
// Reference: directives/03_vacancy_management_rules.md — VAC-200, VAC-700 through VAC-703

export type VacancyStatus = 'DRAFT' | 'OPEN' | 'IN_RECRUITMENT' | 'CLOSED';

export type VacancyPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AgingStatus = 'OK' | 'WARNING' | 'HIGH_RISK';

export type VacancyRow = {
  id: string;
  positionId: string;
  positionTitle: string;
  departmentId: string;
  departmentName: string;
  priority: VacancyPriority | null;
  reason: string | null;
  status: VacancyStatus;
  expectedFillDate: string | null;
  filledAt: string | null;
  createdAt: string;
  updatedAt: string;
  ageInDays: number;
  agingStatus: AgingStatus;
  requiresReview: boolean;
};

export type VacancyListApiResponse = {
  success: true;
  data: {
    vacancies: VacancyRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

// ---------------------------------------------------------------------------
// Step 10 — Create Vacancy
// ---------------------------------------------------------------------------

export type PositionOption = {
  id: string;
  title: string;
  classification: string | null;
};

export type PositionListApiResponse = {
  success: true;
  data: {
    positions: PositionOption[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

export type CreateVacancyBffResponse =
  | { success: true }
  | { success: false; error: { code: string; message: string } };

// ---------------------------------------------------------------------------
// Step 11 — Vacancy Detail
// ---------------------------------------------------------------------------

export type VacancyDetailApiResponse = {
  success: true;
  data: VacancyRow;
};

// ---------------------------------------------------------------------------
// Step 12 — Edit Vacancy + Open Vacancy
// ---------------------------------------------------------------------------

export type UpdateVacancyBffRequest = {
  priority?: string;
  reason?: string;
  expectedFillDate?: string;
  status?: 'OPEN';
};

export type UpdateVacancyBffResponse =
  | { success: true; data: VacancyRow }
  | { success: false; error: { code: string; message: string } };

// ---------------------------------------------------------------------------
// Step 13 — Close Vacancy
// ---------------------------------------------------------------------------

export type CloseVacancyBffResponse =
  | { success: true; data: VacancyRow }
  | { success: false; error: { code: string; message: string } };
