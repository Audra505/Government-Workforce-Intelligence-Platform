// Governing directive: directives/08_audit_rules.md (AUD-200 through AUD-900)
// String values are stored verbatim in audit.audit_events.action.
// Values must remain stable after first use — changing a value is a breaking
// change to existing audit records and compliance reports.
//
// Future phase consideration (not Milestone 4 scope):
//   Audit subsystem observability metrics — audit_write_success_total,
//   audit_write_failure_total, audit_write_failure_rate — should be
//   introduced when a metrics framework is adopted.

export enum AuditEventType {
  // -------------------------------------------------------------------------
  // AUD-200: Authentication Events
  // -------------------------------------------------------------------------
  AUTH_LOGIN_SUCCESS = 'AUTH_LOGIN_SUCCESS',
  AUTH_LOGIN_FAILURE = 'AUTH_LOGIN_FAILURE',
  AUTH_LOGOUT = 'AUTH_LOGOUT',
  AUTH_PASSWORD_RESET = 'AUTH_PASSWORD_RESET',
  AUTH_ACCOUNT_LOCKOUT = 'AUTH_ACCOUNT_LOCKOUT',

  // -------------------------------------------------------------------------
  // AUD-250: Identity User Management Events
  // Reference: directives/08_audit_rules.md — AUD-250
  // Reference: spec/07_security_architecture.md — Mandatory Audit Events (Administration: User Creation)
  // GD-M27-1 Decision 8 adds UPDATED/SUSPENDED/DEACTIVATED/REACTIVATED.
  // -------------------------------------------------------------------------
  IDENTITY_USER_CREATED     = 'IDENTITY_USER_CREATED',
  IDENTITY_USER_UPDATED     = 'IDENTITY_USER_UPDATED',
  IDENTITY_USER_SUSPENDED   = 'IDENTITY_USER_SUSPENDED',
  IDENTITY_USER_DEACTIVATED = 'IDENTITY_USER_DEACTIVATED',
  IDENTITY_USER_REACTIVATED = 'IDENTITY_USER_REACTIVATED',

  // -------------------------------------------------------------------------
  // AUD-300: Authorization Events
  // GD-M27-1 Decision 8 adds AUTHZ_ROLE_REMOVED for role replacement audit.
  // -------------------------------------------------------------------------
  AUTHZ_ROLE_ASSIGNED = 'AUTHZ_ROLE_ASSIGNED',
  AUTHZ_ROLE_REMOVED  = 'AUTHZ_ROLE_REMOVED',
  AUTHZ_PERMISSION_CHANGED = 'AUTHZ_PERMISSION_CHANGED',
  AUTHZ_ACCESS_DENIED = 'AUTHZ_ACCESS_DENIED',
  AUTHZ_PRIVILEGE_ESCALATION_ATTEMPT = 'AUTHZ_PRIVILEGE_ESCALATION_ATTEMPT',

  // -------------------------------------------------------------------------
  // AUD-350: Organization Management Events
  // Reference: directives/08_audit_rules.md — AUD-350
  // Reference: directives/12_organization_management_rules.md — ORG-003
  // -------------------------------------------------------------------------
  ORG_DEPARTMENT_CREATED = 'ORG_DEPARTMENT_CREATED',
  ORG_DEPARTMENT_UPDATED = 'ORG_DEPARTMENT_UPDATED',
  ORG_DEPARTMENT_DEACTIVATED = 'ORG_DEPARTMENT_DEACTIVATED',

  // -------------------------------------------------------------------------
  // AUD-400: Workforce Events
  // -------------------------------------------------------------------------
  WORKFORCE_POSITION_CREATED   = 'WORKFORCE_POSITION_CREATED',
  WORKFORCE_POSITION_UPDATED   = 'WORKFORCE_POSITION_UPDATED',
  WORKFORCE_POSITION_ACTIVATED = 'WORKFORCE_POSITION_ACTIVATED',
  WORKFORCE_POSITION_FROZEN    = 'WORKFORCE_POSITION_FROZEN',
  WORKFORCE_POSITION_CLOSED    = 'WORKFORCE_POSITION_CLOSED',
  WORKFORCE_VACANCY_CREATED   = 'WORKFORCE_VACANCY_CREATED',
  WORKFORCE_VACANCY_UPDATED   = 'WORKFORCE_VACANCY_UPDATED',
  WORKFORCE_VACANCY_OPENED    = 'WORKFORCE_VACANCY_OPENED',
  WORKFORCE_VACANCY_CANCELLED = 'WORKFORCE_VACANCY_CANCELLED',
  WORKFORCE_VACANCY_FILLED    = 'WORKFORCE_VACANCY_FILLED',
  WORKFORCE_VACANCY_CLOSED    = 'WORKFORCE_VACANCY_CLOSED',
  WORKFORCE_EMPLOYEE_CREATED       = 'WORKFORCE_EMPLOYEE_CREATED',
  WORKFORCE_EMPLOYEE_UPDATED       = 'WORKFORCE_EMPLOYEE_UPDATED',
  WORKFORCE_EMPLOYEE_ACTIVATED     = 'WORKFORCE_EMPLOYEE_ACTIVATED',
  WORKFORCE_EMPLOYEE_LEAVE_STARTED = 'WORKFORCE_EMPLOYEE_LEAVE_STARTED',
  WORKFORCE_EMPLOYEE_RETURNED      = 'WORKFORCE_EMPLOYEE_RETURNED',
  WORKFORCE_EMPLOYEE_SUSPENDED     = 'WORKFORCE_EMPLOYEE_SUSPENDED',
  WORKFORCE_EMPLOYEE_REINSTATED    = 'WORKFORCE_EMPLOYEE_REINSTATED',
  WORKFORCE_EMPLOYEE_SEPARATED     = 'WORKFORCE_EMPLOYEE_SEPARATED',

  // -------------------------------------------------------------------------
  // AUD-400: Workforce Events — M13 Skills & Certifications (GD-M13-4 Decision 4)
  // -------------------------------------------------------------------------
  WORKFORCE_SKILL_CREATED               = 'WORKFORCE_SKILL_CREATED',
  WORKFORCE_SKILL_UPDATED               = 'WORKFORCE_SKILL_UPDATED',
  WORKFORCE_CERTIFICATION_CREATED       = 'WORKFORCE_CERTIFICATION_CREATED',
  WORKFORCE_CERTIFICATION_UPDATED       = 'WORKFORCE_CERTIFICATION_UPDATED',
  WORKFORCE_EMPLOYEE_SKILL_ASSIGNED     = 'WORKFORCE_EMPLOYEE_SKILL_ASSIGNED',
  WORKFORCE_EMPLOYEE_SKILL_UPDATED      = 'WORKFORCE_EMPLOYEE_SKILL_UPDATED',
  WORKFORCE_EMPLOYEE_CERT_ASSIGNED      = 'WORKFORCE_EMPLOYEE_CERT_ASSIGNED',
  WORKFORCE_EMPLOYEE_CERT_UPDATED       = 'WORKFORCE_EMPLOYEE_CERT_UPDATED',
  WORKFORCE_EMPLOYEE_CERT_RENEWED       = 'WORKFORCE_EMPLOYEE_CERT_RENEWED',
  WORKFORCE_EMPLOYEE_CERT_REVOKED       = 'WORKFORCE_EMPLOYEE_CERT_REVOKED',

  // -------------------------------------------------------------------------
  // AUD-400: Workforce Events — M15 Position Linkage (GD-M15-1 Decision 9)
  // -------------------------------------------------------------------------
  WORKFORCE_EMPLOYEE_POSITION_ASSIGNED   = 'WORKFORCE_EMPLOYEE_POSITION_ASSIGNED',
  WORKFORCE_EMPLOYEE_POSITION_REASSIGNED = 'WORKFORCE_EMPLOYEE_POSITION_REASSIGNED',
  WORKFORCE_EMPLOYEE_POSITION_CLEARED    = 'WORKFORCE_EMPLOYEE_POSITION_CLEARED',

  // -------------------------------------------------------------------------
  // AUD-400: Workforce Events — M19 Hire-to-Employee (GD-M19-1 Decision 12)
  // -------------------------------------------------------------------------
  WORKFORCE_EMPLOYEE_CREATED_FROM_HIRE           = 'WORKFORCE_EMPLOYEE_CREATED_FROM_HIRE',
  WORKFORCE_VACANCY_FILLED_FROM_HIRE             = 'WORKFORCE_VACANCY_FILLED_FROM_HIRE',
  WORKFORCE_EMPLOYEE_POSITION_ASSIGNED_FROM_HIRE = 'WORKFORCE_EMPLOYEE_POSITION_ASSIGNED_FROM_HIRE',

  // -------------------------------------------------------------------------
  // AUD-500: Recruiting Events
  // M16 adds RECRUITING_CANDIDATE_UPDATED and RECRUITING_CANDIDATE_ARCHIVED
  // (GD-M16-1 Decision 12; GD-PRE-PHASE3-003 D5)
  // M17 adds application lifecycle events (GD-M17-1 Decision 16).
  // RECRUITING_APPLICATION_SUBMITTED already existed — not duplicated.
  // M18A adds interview lifecycle events (GD-M18-1 Decision 17).
  // RECRUITING_INTERVIEW_SCHEDULED already existed as a stub — not duplicated.
  // M18B adds offer lifecycle events (GD-M18-1 Decision 17).
  // RECRUITING_OFFER_CREATED already existed as a stub — M18B adds the 7 remaining offer events.
  // -------------------------------------------------------------------------
  RECRUITING_CANDIDATE_CREATED  = 'RECRUITING_CANDIDATE_CREATED',
  RECRUITING_CANDIDATE_UPDATED  = 'RECRUITING_CANDIDATE_UPDATED',
  RECRUITING_CANDIDATE_ARCHIVED = 'RECRUITING_CANDIDATE_ARCHIVED',
  RECRUITING_APPLICATION_SUBMITTED       = 'RECRUITING_APPLICATION_SUBMITTED',
  RECRUITING_APPLICATION_STATUS_CHANGED  = 'RECRUITING_APPLICATION_STATUS_CHANGED',
  RECRUITING_APPLICATION_ADVANCED        = 'RECRUITING_APPLICATION_ADVANCED',
  RECRUITING_APPLICATION_REJECTED        = 'RECRUITING_APPLICATION_REJECTED',
  RECRUITING_APPLICATION_WITHDRAWN       = 'RECRUITING_APPLICATION_WITHDRAWN',
  RECRUITING_INTERVIEW_SCHEDULED         = 'RECRUITING_INTERVIEW_SCHEDULED',
  RECRUITING_INTERVIEW_UPDATED           = 'RECRUITING_INTERVIEW_UPDATED',
  RECRUITING_INTERVIEW_COMPLETED         = 'RECRUITING_INTERVIEW_COMPLETED',
  RECRUITING_INTERVIEW_CANCELLED         = 'RECRUITING_INTERVIEW_CANCELLED',
  RECRUITING_INTERVIEW_NO_SHOW           = 'RECRUITING_INTERVIEW_NO_SHOW',
  RECRUITING_INTERVIEW_FEEDBACK_RECORDED = 'RECRUITING_INTERVIEW_FEEDBACK_RECORDED',
  RECRUITING_OFFER_CREATED               = 'RECRUITING_OFFER_CREATED',
  RECRUITING_OFFER_UPDATED               = 'RECRUITING_OFFER_UPDATED',
  RECRUITING_OFFER_SUBMITTED             = 'RECRUITING_OFFER_SUBMITTED',
  RECRUITING_OFFER_APPROVED              = 'RECRUITING_OFFER_APPROVED',
  RECRUITING_OFFER_SENT                  = 'RECRUITING_OFFER_SENT',
  RECRUITING_OFFER_ACCEPTED              = 'RECRUITING_OFFER_ACCEPTED',
  RECRUITING_OFFER_DECLINED              = 'RECRUITING_OFFER_DECLINED',
  RECRUITING_OFFER_WITHDRAWN             = 'RECRUITING_OFFER_WITHDRAWN',
  RECRUITING_CANDIDATE_HIRED             = 'RECRUITING_CANDIDATE_HIRED',

  // -------------------------------------------------------------------------
  // AUD-600: Scheduling Events
  // -------------------------------------------------------------------------
  SCHEDULING_SCHEDULE_CREATED = 'SCHEDULING_SCHEDULE_CREATED',
  SCHEDULING_SCHEDULE_PUBLISHED = 'SCHEDULING_SCHEDULE_PUBLISHED',
  SCHEDULING_ASSIGNMENT_CREATED = 'SCHEDULING_ASSIGNMENT_CREATED',
  SCHEDULING_ASSIGNMENT_REMOVED = 'SCHEDULING_ASSIGNMENT_REMOVED',
  SCHEDULING_COVERAGE_ALERT_GENERATED = 'SCHEDULING_COVERAGE_ALERT_GENERATED',

  // -------------------------------------------------------------------------
  // AUD-700: AI Events
  // -------------------------------------------------------------------------
  AI_FORECAST_GENERATED = 'AI_FORECAST_GENERATED',
  AI_FORECAST_APPROVED = 'AI_FORECAST_APPROVED',
  AI_MATCH_GENERATED = 'AI_MATCH_GENERATED',
  AI_ATTRITION_ANALYSIS_GENERATED = 'AI_ATTRITION_ANALYSIS_GENERATED',
  AI_RECOMMENDATION_VIEWED = 'AI_RECOMMENDATION_VIEWED',

  // -------------------------------------------------------------------------
  // AUD-800: Reporting Events
  // -------------------------------------------------------------------------
  REPORTING_REPORT_GENERATED = 'REPORTING_REPORT_GENERATED',
  REPORTING_REPORT_EXPORTED = 'REPORTING_REPORT_EXPORTED',
  REPORTING_REPORT_DELETED = 'REPORTING_REPORT_DELETED',
  REPORTING_REPORT_ACCESSED = 'REPORTING_REPORT_ACCESSED',

  // -------------------------------------------------------------------------
  // AUD-800+: Intelligence Events — Phase 4 (GD-M30-1 Decision 9)
  // FR-904: All intelligence queries must be auditable from day one.
  // -------------------------------------------------------------------------
  INTELLIGENCE_VACANCY_RISK_QUERIED = 'INTELLIGENCE_VACANCY_RISK_QUERIED',
  // GD-M31-1 Decision 9: workforce readiness queries auditable from day one.
  INTELLIGENCE_WORKFORCE_READINESS_QUERIED = 'INTELLIGENCE_WORKFORCE_READINESS_QUERIED',
  // GD-M32-1 Decision 9: aggregate attrition risk queries auditable from day one.
  INTELLIGENCE_ATTRITION_RISK_QUERIED = 'INTELLIGENCE_ATTRITION_RISK_QUERIED',
  // GD-M33-1 Decision 10: department-gap queries auditable from day one.
  INTELLIGENCE_DEPARTMENT_GAP_QUERIED = 'INTELLIGENCE_DEPARTMENT_GAP_QUERIED',
  // GD-M34-1 Decision 11: executive-metrics queries auditable from day one.
  INTELLIGENCE_EXECUTIVE_METRICS_QUERIED = 'INTELLIGENCE_EXECUTIVE_METRICS_QUERIED',

  // -------------------------------------------------------------------------
  // AUD-900: Integration Events
  // -------------------------------------------------------------------------
  INTEGRATION_SYNC_STARTED = 'INTEGRATION_SYNC_STARTED',
  INTEGRATION_SYNC_COMPLETED = 'INTEGRATION_SYNC_COMPLETED',
  INTEGRATION_SYNC_FAILED = 'INTEGRATION_SYNC_FAILED',
  INTEGRATION_CONNECTOR_ADDED = 'INTEGRATION_CONNECTOR_ADDED',
  INTEGRATION_CONNECTOR_UPDATED = 'INTEGRATION_CONNECTOR_UPDATED',

  // -------------------------------------------------------------------------
  // Elevation Session Events — Milestone 37 (governance/GD-M37-1.md Decision 18)
  // Written only via ElevationSessionService's strict, transaction-aware audit
  // write path (GD-M37-1 Decision 14) — a narrow exception to this platform's
  // otherwise write-only/best-effort AuditService.logEvent() (AUD-1300).
  // "ACTIVATED" records only the lifecycle-active data fact (APPROVED →
  // ACTIVE); it never implies real, authorization-effective access was
  // granted (GD-M37-1 Decision 20).
  // -------------------------------------------------------------------------
  ELEVATION_SESSION_REQUESTED         = 'ELEVATION_SESSION_REQUESTED',
  ELEVATION_SESSION_CAPABILITY_DECIDED = 'ELEVATION_SESSION_CAPABILITY_DECIDED',
  ELEVATION_SESSION_APPROVED          = 'ELEVATION_SESSION_APPROVED',
  ELEVATION_SESSION_DENIED            = 'ELEVATION_SESSION_DENIED',
  ELEVATION_SESSION_CANCELLED         = 'ELEVATION_SESSION_CANCELLED',
  ELEVATION_SESSION_ACTIVATED         = 'ELEVATION_SESSION_ACTIVATED',
  ELEVATION_SESSION_ACTIVATION_FAILED = 'ELEVATION_SESSION_ACTIVATION_FAILED',
  ELEVATION_SESSION_EXPIRED           = 'ELEVATION_SESSION_EXPIRED',
  ELEVATION_SESSION_REVOKED           = 'ELEVATION_SESSION_REVOKED',

  // -------------------------------------------------------------------------
  // Decision Case and Approval Foundation Events — Milestone 38
  // (governance/GD-M38-1.md Decision 17)
  // Written only via DecisionCaseService/ApprovalService's strict,
  // transaction-aware audit write path (AuditService.logEventStrict()),
  // reusing the exact write path GD-M37-1 Decision 14 established — a
  // narrow exception to this platform's otherwise write-only/best-effort
  // AuditService.logEvent() (AUD-1300). An "APPROVED" DecisionCase record
  // is a modeled fact only; it never implies a real business action was
  // executed or authorized (GD-M38-1 Decision 4).
  // -------------------------------------------------------------------------
  DECISION_CASE_CREATED               = 'DECISION_CASE_CREATED',
  DECISION_CASE_EVIDENCE_ATTACHED     = 'DECISION_CASE_EVIDENCE_ATTACHED',
  DECISION_CASE_RISK_TRIGGER_CREATED  = 'DECISION_CASE_RISK_TRIGGER_CREATED',
  APPROVAL_REQUEST_SUBMITTED          = 'APPROVAL_REQUEST_SUBMITTED',
  APPROVAL_REQUEST_SUPERSEDED         = 'APPROVAL_REQUEST_SUPERSEDED',
  APPROVAL_DECISION_GRANTED           = 'APPROVAL_DECISION_GRANTED',
  APPROVAL_DECISION_REJECTED          = 'APPROVAL_DECISION_REJECTED',
  APPROVAL_DECISION_NEEDS_INFORMATION = 'APPROVAL_DECISION_NEEDS_INFORMATION',
  DECISION_CASE_NEEDS_INFORMATION     = 'DECISION_CASE_NEEDS_INFORMATION',
  DECISION_CASE_RESUBMITTED           = 'DECISION_CASE_RESUBMITTED',
  DECISION_CASE_APPROVED              = 'DECISION_CASE_APPROVED',
  DECISION_CASE_REJECTED              = 'DECISION_CASE_REJECTED',
  DECISION_CASE_CANCELLED             = 'DECISION_CASE_CANCELLED',

  // -------------------------------------------------------------------------
  // Audit Read, Recovery, and Integrity Foundation Events — Milestone 39
  // (governance/GD-M39-1.md Decision 22)
  // AUDIT_LOG_QUERIED is written via logEvent() on every audit-read API call
  // (Decision 17). The AUDIT_WRITE_RECOVERY_* and AUDIT_CHAIN_* events are
  // written only via AuditService.logEventStrict() (human-initiated:
  // AUDIT_WRITE_RECOVERY_REQUEUED, AUDIT_CHAIN_REVERIFICATION_REQUESTED) or
  // AuditService.logOperationalEvent() (worker-generated supplemental
  // notifications: AUDIT_WRITE_RECOVERY_SUCCEEDED,
  // AUDIT_WRITE_RECOVERY_ABANDONED, AUDIT_CHAIN_VERIFICATION_FAILED) —
  // Decision 14's strict-versus-operational boundary.
  // -------------------------------------------------------------------------
  AUDIT_LOG_QUERIED                    = 'AUDIT_LOG_QUERIED',
  AUDIT_WRITE_RECOVERY_SUCCEEDED       = 'AUDIT_WRITE_RECOVERY_SUCCEEDED',
  AUDIT_WRITE_RECOVERY_ABANDONED       = 'AUDIT_WRITE_RECOVERY_ABANDONED',
  AUDIT_WRITE_RECOVERY_REQUEUED        = 'AUDIT_WRITE_RECOVERY_REQUEUED',
  AUDIT_CHAIN_VERIFICATION_FAILED      = 'AUDIT_CHAIN_VERIFICATION_FAILED',
  AUDIT_CHAIN_REVERIFICATION_REQUESTED = 'AUDIT_CHAIN_REVERIFICATION_REQUESTED',
}
