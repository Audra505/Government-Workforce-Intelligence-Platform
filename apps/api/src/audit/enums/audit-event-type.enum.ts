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
  // AUD-300: Authorization Events
  // -------------------------------------------------------------------------
  AUTHZ_ROLE_ASSIGNED = 'AUTHZ_ROLE_ASSIGNED',
  AUTHZ_PERMISSION_CHANGED = 'AUTHZ_PERMISSION_CHANGED',
  AUTHZ_ACCESS_DENIED = 'AUTHZ_ACCESS_DENIED',
  AUTHZ_PRIVILEGE_ESCALATION_ATTEMPT = 'AUTHZ_PRIVILEGE_ESCALATION_ATTEMPT',

  // -------------------------------------------------------------------------
  // AUD-400: Workforce Events
  // -------------------------------------------------------------------------
  WORKFORCE_POSITION_CREATED = 'WORKFORCE_POSITION_CREATED',
  WORKFORCE_POSITION_UPDATED = 'WORKFORCE_POSITION_UPDATED',
  WORKFORCE_POSITION_CLOSED = 'WORKFORCE_POSITION_CLOSED',
  WORKFORCE_VACANCY_CREATED = 'WORKFORCE_VACANCY_CREATED',
  WORKFORCE_VACANCY_FILLED = 'WORKFORCE_VACANCY_FILLED',
  WORKFORCE_VACANCY_CLOSED = 'WORKFORCE_VACANCY_CLOSED',
  WORKFORCE_EMPLOYEE_CREATED = 'WORKFORCE_EMPLOYEE_CREATED',
  WORKFORCE_EMPLOYEE_UPDATED = 'WORKFORCE_EMPLOYEE_UPDATED',
  WORKFORCE_EMPLOYEE_DEACTIVATED = 'WORKFORCE_EMPLOYEE_DEACTIVATED',

  // -------------------------------------------------------------------------
  // AUD-500: Recruiting Events
  // -------------------------------------------------------------------------
  RECRUITING_CANDIDATE_CREATED = 'RECRUITING_CANDIDATE_CREATED',
  RECRUITING_APPLICATION_SUBMITTED = 'RECRUITING_APPLICATION_SUBMITTED',
  RECRUITING_INTERVIEW_SCHEDULED = 'RECRUITING_INTERVIEW_SCHEDULED',
  RECRUITING_OFFER_CREATED = 'RECRUITING_OFFER_CREATED',
  RECRUITING_CANDIDATE_HIRED = 'RECRUITING_CANDIDATE_HIRED',

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
  // AUD-900: Integration Events
  // -------------------------------------------------------------------------
  INTEGRATION_SYNC_STARTED = 'INTEGRATION_SYNC_STARTED',
  INTEGRATION_SYNC_COMPLETED = 'INTEGRATION_SYNC_COMPLETED',
  INTEGRATION_SYNC_FAILED = 'INTEGRATION_SYNC_FAILED',
  INTEGRATION_CONNECTOR_ADDED = 'INTEGRATION_CONNECTOR_ADDED',
  INTEGRATION_CONNECTOR_UPDATED = 'INTEGRATION_CONNECTOR_UPDATED',
}
