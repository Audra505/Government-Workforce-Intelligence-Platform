# Governance History

Project: AI-Driven Staffing Optimization Platform for Government HR

Status: Living Document — append-only chronological ledger

Purpose:
This file is the authoritative index of all governance decisions in the repository.
Each entry summarizes the decision ID, date, subject, and one-line impact.
Full decision text lives in the individual GD-*.md files.

---

## M12 — Employee Management Foundation

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-M12-1 | 2026-06-18 | Employee Lifecycle State Authority | Establishes PENDING_ONBOARDING, ACTIVE, ON_LEAVE, SUSPENDED, SEPARATED as canonical states; forbids 8 invalid transitions; designates state/02_employee_lifecycle.md as authoritative |
| GD-M12-2 | 2026-06-18 | Employee Position Field Authority | No positionId or any position reference on the employee record in Phase 2; position linkage deferred to Scheduling domain (Phase 3) |
| GD-M12-3 | 2026-06-18 | Employee RBAC Authority | EMP-AUTH-001 through EMP-AUTH-005 defined; RBAC-952 hard prohibition on Executive User access to employee PII records |
| GD-M12-4 | 2026-06-18 | Skills and Certifications Scope Boundary | FR-113 and FR-114 deferred to M13; workforce.skills, certifications, employee_skills, employee_certifications tables not created in M12; M13 scope list defined in EMP-601 |
| GD-M12-5 | 2026-06-18 | Employee Availability Authority | Employment status field is the Phase 2 availability representation; scheduling engine integration deferred to Phase 3 |
| GD-M12-6 | 2026-06-18 | Employee Number Immutability | employeeNumber immutable after creation; PUT with employeeNumber field returns HTTP 422 + EMPLOYEE_NUMBER_IMMUTABLE |
| GD-M12-8 | 2026-06-19 | Employee Date Integrity — Termination Before Hire Date | SEPARATED transition blocked when terminationDate (today) < hireDate; EMP-805 enforced at service layer |

Note: GD-M12-7 was flagged as an open issue (ON_LEAVE → SEPARATED workaround via ACTIVE intermediary
creates audit trail distortion) but was not issued as a formal governance decision. It remains open
and is tracked in state/02_employee_lifecycle.md.

---

## Pre-M13 — Housekeeping and Verification Gate

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-PRE-M13-001 | 2026-06-19 | VAC-401 Dual-Path Authority Classification and Appointment Authority Design | Codifies two permanent employee creation paths (non-competitive administrative and competitive VAC-401 future); appointmentAuthority field design recorded; COMPETITIVE_APPOINTMENT reserved as system-only value |
| GD-PRE-M13-002 | 2026-06-19 | Position Linkage FTE Slot Model | 1:1 FTE slot model adopted; positionId nullable at creation; position linkage deferred beyond M13; supersedes M13 timing assumption in GD-M12-2 |
| GD-PRE-M13-003 | 2026-06-19 | DEP-008 Trigger Confirmation | Employee constraint active immediately (Phase A); position constraint deferred to position linkage milestone (Phase B); 4-criteria verification gate defined; no override mechanism |

---

## M13 — Skills & Certifications Foundation

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-M13-1 | 2026-06-19 | Skills and Certifications Catalog Tenant Scope | Catalog is per-tenant; tenant_id added to workforce.skills and workforce.certifications (spec deviation — authorized correction of spec oversight); SEC-003 applies to all catalog endpoints; Decision 7 declares complete column set including created_at, updated_at, deleted_at |
| GD-M13-2 | 2026-06-19 | Skills and Certifications Catalog API Design | Authorizes catalog CRUD endpoints not in spec/06; defines controller structure, RBAC (13 decisions), request contracts, EMP-302 enforcement on assignment endpoints, upsert semantics |
| GD-M13-2 D14 | 2026-06-20 | GET /api/v1/employees/{id}/skills Response Contract | Flat non-paginated array; embeds skillName + skillCategory from JOIN to workforce.skills; proficiencyLevel and verifiedAt from junction table; tenantId and description excluded (SEC-003 and payload hygiene); soft-deleted skill refs preserved with null catalog fields |
| GD-M13-2 D15 | 2026-06-20 | Assignment Endpoint HTTP Status Differentiation | INSERT path → HTTP 201 Created; UPDATE path → HTTP 200 OK; applies to POST /employees/{id}/skills (Step 4) and POST /employees/{id}/certifications (Step 5) |
| GD-M13-3 | 2026-06-19 | Employee Certification Status Enumeration | Canonical values: ACTIVE, EXPIRED, REVOKED; ACTIVE is the default when status omitted; REVOKED is terminal; SKM-302 forward compatibility declared |
| GD-M13-4 | 2026-06-19 | Employee Skills and Certifications History Retention Strategy | Audit event trail satisfies FR-113 "history retained"; composite PKs from spec/05 implemented exactly; 10 new AuditEventType values defined; upsert semantics for all assignment endpoints |
| GD-M13-5 | 2026-06-19 | Position Skills and Certifications Requirements — Explicit Deferral | position_skills and position_certifications tables and endpoints deferred beyond M13; FR-100 Required Skills/Certifications maturity classified as Planned; 4 prerequisites defined for future milestone |

---

## Phase 2 Closure — Formal Closure Governance

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-PHASE2-CLOSURE-001 | 2026-06-21 | Phase 2 Exit Criteria Reconciliation — Notification Integration and Workforce Dashboards | Establishes spec/15 authority over execution/03; reclassifies Notifications and Dashboards as Phase 5 deliverables; closes PROGRESS.md Phase 2 blocking records from 2026-06-18 |
| GD-PHASE2-CLOSURE-002 | 2026-06-21 | Position Management UI — Formal Deferral to Position Linkage Milestone | Defers spec/15 Phase 2 UI deliverable "Position Management" to Position Linkage Milestone; binding requirement on that milestone to deliver complete UI with occupant display, POSITION_HAS_ACTIVE_INCUMBENT guard, and assignment workflow |
| GD-PHASE2-CLOSURE-003 | 2026-06-22 | D-005 Scheduling Domain — Phase Assignment and Roadmap Gap Resolution | Assigns D-005 (FR-200/FR-202/FR-204) to Phase 8 (Scale & Evolution) — provisional pending project owner review; supersedes incidental "Phase 3 Scheduling" assumption in GD-M12-2 and GD-M12-5 for D-005 phase placement only; corrects stale PROGRESS.md D-005 entry; closes roadmap gap open since Phase 2 closure |

---

## M14 — Certification Expiration Tracking

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-M14-1 | 2026-06-21 | M14 Endpoint Ownership — Employee Certification Collection Namespace | Reserves /certifications for catalog only; reserves /employees/:id/certifications for employee-scoped assignments; approves /employee-certifications as cross-employee assignment collection namespace; authorizes GET /api/v1/employee-certifications/expiring with RBAC and scope boundary for M14 |

---

## M15 — Position Linkage

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-M15-1 | 2026-06-22 | M15 Position Linkage Milestone — Schema, API, and Lifecycle Design Authority | Resolves 10 unspecified decisions from GD-PRE-M13-001/002/003 and GD-PHASE2-CLOSURE-002: authorizes spec/05 deviations (appointment_authority and position_id columns on employees); authorizes backfill of existing records with ADMINISTRATIVE; amends POST /employees body (appointmentAuthority required; positionId optional); establishes POST /employees/{id}/assign-position as dedicated action endpoint; defines position clearance rules (PENDING_ONBOARDING only); records GET /positions/{id} occupant response contract; defines APPOINTMENT_AUTHORITY_IMMUTABLE error code; adds 3 AuditEventType values; confirms RBAC (SA + HR Director) |

---

## Pre-Phase-3 — Phase 3 Entry Governance

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-PRE-PHASE3-001 | 2026-06-27 | Phase 3 Scope Boundary, Execution/04 Alignment, and D-005 Scheduling Confirmation | Confirms Phase 3 (Recruiting & Staffing) as next major phase; defines early Phase 3 scope (candidate/application/interview/offer/hire); excludes Notifications (Phase 5), Dashboards (Phase 5), AI resume parsing (Phase 4), AI skill matching (Phase 4), FR-152 (pending GD-PRE-PHASE3-004), and Position Skills/Certs (pending GD-M13-5-FOLLOWUP); amends execution/04 Deliverables 8 and 10 per GD-PHASE2-CLOSURE-001; confirms D-005 Scheduling at Phase 8 (project owner confirmed); M16 blocked until GD-PRE-PHASE3-002 and GD-PRE-PHASE3-003 approved |
| GD-PRE-PHASE3-004 | 2026-06-27 | FR-152 Competency Framework — Phase Assignment and Early Phase 3 Exclusion | Assigns FR-152 to Phase 4 Intelligence; formally excludes FR-152 from all early Phase 3 milestones (M16–M20); records GD-M13-5-FOLLOWUP and Phase 4 AI architecture as implementation prerequisites; Phase 3 not blocked by FR-152; satisfies the required predecessor condition stated in GD-PRE-PHASE3-001 |
| GD-PRE-PHASE3-002 | 2026-06-27 | Candidate Domain Data Model, Schema Authority, and Tenant Isolation | Corrects SEC-003 tenant isolation defects in spec/05 (adds tenant_id to applications, interviews, offers, resumes); defines offers table (missing from spec/05); establishes canonical status values for candidates (ACTIVE/ARCHIVED), applications (APPLIED…HIRED), interviews (SCHEDULED…NO_SHOW), offers (DRAFT…WITHDRAWN); defines interview_type column and dual interviewer fields; establishes one-active-application-per-candidate-per-vacancy uniqueness constraint; records hire-to-employee boundary items for future GD; excludes resume file storage, AI parsing, and all implementation; M16 blocked until GD-PRE-PHASE3-003 approved |
| GD-PRE-PHASE3-003 | 2026-06-27 | Recruiting RBAC Authority — Phase 3 Endpoint Access Matrix | Resolves spec/06 vs RBAC-700 conflict (HR Director has full candidate access; Hiring Manager access is scoped not global); defines per-endpoint RBAC for candidates/applications/interviews/offers/hire across 7 roles; restricts hire-to-employee and offer approval to SA + HRD only; Hiring Manager limited to scoped application/vacancy context from M17 (no M16 access); Workforce Planner and Executive User have no Phase 3 recruiting access; authorizes audit event categories; M16 Candidate Management Foundation may now be planned |

---

## M16 — Candidate Management Foundation

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-M16-1 | 2026-06-27 | M16 Candidate Management Foundation — Scope Decision | Authorizes M16 as first Phase 3 implementation milestone (backend-only, candidates only); defines exact candidate column set per GD-PRE-PHASE3-002; mandates partial unique index (tenant_id, email WHERE deleted_at IS NULL) via hand-edited migration SQL, NOT @@unique in schema.prisma; specifies 5 endpoints with RBAC per GD-PRE-PHASE3-003 D4; requires RECRUITING_CANDIDATE_UPDATED and RECRUITING_CANDIDATE_ARCHIVED audit enum additions; defines 3 DTOs, service discriminated-union return types, SEC-003 tenant isolation rules, HAS_ACTIVE_APPLICATIONS stub for M17; specifies DTO unit + service unit + controller unit + E2E test requirements; defines 12 new files + 3 modified files; mandates 10-step implementation sequence; excludes all frontend, applications, interviews, offers, resume, AI, hire, notifications, FR-152 |

---

## M17 — Application Management Foundation

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-M17-1 | 2026-06-29 | M17 Application Management Foundation — Scope Decision | Authorizes M17 as second Phase 3 implementation milestone (backend-only, applications only); defines recruiting.applications table per GD-PRE-PHASE3-002 D4 with hand-edited partial unique index (tenant_id, candidate_id, vacancy_id WHERE deleted_at IS NULL AND status NOT IN REJECTED/WITHDRAWN); authorizes 7 endpoints (create/list/detail/update/advance/reject/withdraw); resolves advance endpoint semantics as Option B (explicit targetStatus); defines HIRED as unreachable in M17 (reserved M19); records APPLICATION_AWAITING_HIRE as advance-from-OFFER outcome; defers Hiring Manager scoped access (no governed manager-to-department model in identity schema; HM denied all application access in M17); formally defers POS-301 and VAC-601 (no governing spec; neither blocks M17); authorizes VAC-301 (first application → vacancy OPEN → IN_RECRUITMENT via direct Prisma updateMany; non-atomic; self-healing inconsistency risk documented); authorizes replacement of M16 CANDIDATE_HAS_ACTIVE_APPLICATIONS stub with real query (HIRED included in block list); adds 4 new AuditEventType values (SUBMITTED already exists); mandates PII-safe audit metadata; defines 21 decisions; excludes frontend, interviews, offers, resumes, AI, hire-to-employee, POST .../hire, POST .../offer, POS-301, VAC-601, FR-152, notifications, dashboards, scheduling |

---

## M18 — Interview and Offer Management

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-M18-1 | 2026-06-30 | M18 Interview and Offer Management — Scope Decision | Authorizes M18 as third Phase 3 implementation milestone (backend-only); adds two new recruiting domain tables (recruiting.interviews, recruiting.offers); defines 8 interview endpoints (lifecycle: SCHEDULED→COMPLETED/CANCELLED/NO_SHOW, feedback recording) and 9 offer endpoints (lifecycle: DRAFT→PENDING_APPROVAL→APPROVED→SENT→ACCEPTED/DECLINED/WITHDRAWN); establishes no-hire invariant (application stays at OFFER; hire-to-employee deferred to M19); defines re-offer logic (DECLINED/WITHDRAWN unblock; ACCEPTED blocks new offer); enforces RBAC per GD-PRE-PHASE3-003 D16 (SA+HRD approve and send offers; Recruiter manages interview scheduling; Recruiter and HM submit offers); mandates PII-safe audit metadata; defers hire-to-employee conversion to M19; excludes all frontend, AI resume parsing, notifications, dashboards, FR-152 |

---

## M19 — Hire-to-Employee Conversion

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-M19-1 | 2026-06-30 | M19 Hire-to-Employee Conversion — Scope Decision | Authorizes M19 as fourth Phase 3 implementation milestone (backend-only, single endpoint); delivers `POST /api/v1/applications/:id/hire` — no new tables, no migrations, no schema changes; employee creation uses existing `workforce.employees`; atomic transaction sets application→HIRED, vacancy→FILLED+filledAt, creates PENDING_ONBOARDING COMPETITIVE_APPOINTMENT employee, displaces active co-vacancy applications→REJECTED; offer left as ACCEPTED; 4 audit events emitted (RECRUITING_CANDIDATE_HIRED, WORKFORCE_EMPLOYEE_CREATED_FROM_HIRE, WORKFORCE_VACANCY_FILLED_FROM_HIRE, WORKFORCE_EMPLOYEE_POSITION_ASSIGNED_FROM_HIRE); PII-safe metadata (vacancyId+candidateId UUIDs only); RBAC: SA+HRD only; Recruiter/CO/HM/WP/EU denied; idempotency: 409 APPLICATION_ALREADY_HIRED; vacancy guard: 422 VACANCY_NOT_AVAILABLE; employee number: EMP-NNN sequential with collision guard; offer acceptance alone does not create an employee; excludes all frontend, hiring_events table, AI, notifications, dashboards, FR-152 |

---

## M20 — Recruiting UI (Recruiter Workspace)

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-M20-1 | 2026-07-01 | M20 Recruiting UI — Platform Design System and Recruiter Workspace Scope | Authorizes M20 as the first Phase 3 UI milestone; delivers four recruiting screens (Candidates, Applications, Interviews, Offers) as a single Recruiter Workspace under /recruiting; establishes platform-wide M20 design system: navy header #0c2340, GWIP wordmark, domain nav, inline tab bar with count badges, breadcrumb, canvas #f8fafc, palette BORDER #e2e8f0 / TEXT #0f172a / SUB #475569 / MUTED #94a3b8 / BLUE #2563eb / ERROR #dc2626, dot+label status indicators (pills prohibited on lifecycle status), 48px table rows with uppercase 11px headers, bottom-right toast system (success 4s / error 8s), IBM Plex Sans/Mono self-hosted fonts; SEC-003: tenantId never in browser; RBAC: canCreate (SA+HRD+Recruiter) gates schedule-interview and new-offer actions, canWrite gates all other write actions; shared sidebar explicitly deferred to future milestone; Schedule Interview form collapses dual interviewer fields into single input with UUID auto-routing; all 30 Phase 3 endpoints consumed (M16–M19 backend); CI green on commits 4f55ac8 + 28ea758 + 6e6777b; excludes Hiring Manager workspace, AI features, dashboards, notifications, export, file upload, Workforce UI reconciliation |

---

## M21 — Platform-Wide Design System Reconciliation

| ID | Date | Subject | Impact |
|---|---|---|---|
| GD-M21-1 | 2026-07-02 | M21 Platform-Wide Design Reconciliation — Workforce UI Alignment to M20 Design Baseline | Approved 2026-07-02 (Audra / Project Mentor); all three batches implemented and pushed — M21A (d89f7f4), M21B (33679fc), M21C (0fc376c); 6 additional visual polish commits applied post-M21C through HEAD 1036c92 (see PROGRESS.md M21 section for detail); introduces WorkforceShell shared layout component (navy header, GWIP wordmark, domain nav, tab bar, breadcrumb, IBM Plex Sans, #f8fafc canvas, max-w-[1200px]); extracts shared utilities: getSessionRoles→lib/session.ts, unified LogoutButton, StatusDot primitive→components/shared/status-dot.tsx, useToast+ToastContainer→components/shared/toast.tsx, shared Pagination and EmptyState components; converts Workforce entity lifecycle status indicators (Position/Employment/Vacancy) from pill badges to dot+label format; retains PriorityBadge and AgingCell as pills (severity data, not lifecycle); aligns table headers (uppercase 11px letterSpacing #94a3b8), table borders (#e2e8f0), row height (48px); adds toast feedback to Workforce write operations; preserves Workforce form stack (react-hook-form+Zod); preserves all RBAC gates without change; backend/Prisma/BFF/middleware frozen; post-scope visual polish (login redesign, dashboard redesign, Dashboard nav link in both shells, action button color alignment) mentor-acknowledged 2026-07-03; browser verification confirmed by human 2026-07-03; CI confirmed for all commits through 1e33420; M21 CLOSED 2026-07-03 |

---

## Shared Column Confirmation (Implementation Confirmation — Not a Governance Decision)

| Date | Subject | Outcome |
|---|---|---|
| 2026-06-19 | workforce.skills and workforce.certifications shared column resolution | created_at, updated_at, deleted_at added to both catalog tables under spec/05 Shared Columns principle and soft-delete strategy; recorded in GD-M13-1 Decision 7; no new governance decision required |
