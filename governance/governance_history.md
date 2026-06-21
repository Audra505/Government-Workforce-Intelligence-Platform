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

---

## Shared Column Confirmation (Implementation Confirmation — Not a Governance Decision)

| Date | Subject | Outcome |
|---|---|---|
| 2026-06-19 | workforce.skills and workforce.certifications shared column resolution | created_at, updated_at, deleted_at added to both catalog tables under spec/05 Shared Columns principle and soft-delete strategy; recorded in GD-M13-1 Decision 7; no new governance decision required |
