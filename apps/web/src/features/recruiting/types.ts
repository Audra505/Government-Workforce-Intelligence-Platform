// Recruiting domain types for the frontend.
// Mirror the NestJS response shapes from Phase 3 endpoints (M16–M19).
// tenantId intentionally absent from all types — excluded by API per SEC-003 (GD-M20-1 D6).
// Reference: governance/GD-M20-1.md — Decision 14
// Reference: governance/GD-PRE-PHASE3-002.md — canonical status values (D5/D6/D8/D9)

// ---------------------------------------------------------------------------
// Candidate (M16)
// ---------------------------------------------------------------------------

export type CandidateStatus = 'ACTIVE' | 'ARCHIVED';

// source and notes are returned by both list and detail (same toCandidateShape function)
export type CandidateRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  status: CandidateStatus;
  source: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CandidateListApiResponse = {
  success: true;
  data: {
    candidates: CandidateRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

export type CandidateDetailApiResponse = {
  success: true;
  data: CandidateRow;
};

// ---------------------------------------------------------------------------
// Application (M17)
// ---------------------------------------------------------------------------

export type ApplicationStatus =
  | 'APPLIED'
  | 'SCREENING'
  | 'INTERVIEW'
  | 'EVALUATION'
  | 'OFFER'
  | 'HIRED'
  | 'REJECTED'
  | 'WITHDRAWN';

export type ApplicationRow = {
  id: string;
  candidateId: string;
  vacancyId: string;
  status: ApplicationStatus;
  submittedAt: string;
  currentStage: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApplicationListApiResponse = {
  success: true;
  data: {
    applications: ApplicationRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

export type ApplicationDetailApiResponse = {
  success: true;
  data: ApplicationRow;
};

// ---------------------------------------------------------------------------
// Interview (M18)
// ---------------------------------------------------------------------------

export type InterviewStatus = 'SCHEDULED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
export type InterviewType = 'PHONE_SCREEN' | 'PANEL' | 'TECHNICAL' | 'FINAL';

export type InterviewRow = {
  id: string;
  applicationId: string;
  interviewType: InterviewType;
  scheduledAt: string | null;
  status: InterviewStatus;
  interviewerName: string | null;
  interviewerUserId: string | null;
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InterviewListApiResponse = {
  success: true;
  data: {
    interviews: InterviewRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

export type InterviewDetailApiResponse = {
  success: true;
  data: InterviewRow;
};

// ---------------------------------------------------------------------------
// Offer (M18)
// ---------------------------------------------------------------------------

export type OfferStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'SENT'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'WITHDRAWN';

export type OfferRow = {
  id: string;
  applicationId: string;
  status: OfferStatus;
  offerDate: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OfferListApiResponse = {
  success: true;
  data: {
    offers: OfferRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
};

export type OfferDetailApiResponse = {
  success: true;
  data: OfferRow;
};

// ---------------------------------------------------------------------------
// Vacancy info — requiresReview badge on application detail
// ---------------------------------------------------------------------------

export type VacancyInfoApiResponse = {
  success: true;
  data: { id: string; positionTitle: string; requiresReview: boolean };
};
