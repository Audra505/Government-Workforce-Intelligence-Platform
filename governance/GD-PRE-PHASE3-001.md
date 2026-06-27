# Governance Decision: GD-PRE-PHASE3-001
# Phase 3 Scope Boundary, Execution/04 Alignment, and D-005 Scheduling Confirmation

Project: AI-Driven Staffing Optimization Platform for Government HR

Decision ID: GD-PRE-PHASE3-001

Status: Approved

Date: 2026-06-27

Approved By: Product Owner — Pre-Phase-3 Governance Review

Milestone Context:
Pre-Phase-3 governance recording. Governs Phase 3 Recruiting & Staffing entry
conditions, scope boundary, execution/04 alignment with prior governance decisions,
and final D-005 Scheduling roadmap confirmation.

References:

- spec/15_implementation_roadmap.md (Phase 3 deliverables and success criteria)
- execution/04_phase_3_recruiting_and_staffing.md (Phase 3 execution plan)
- governance/GD-PHASE2-CLOSURE-001.md (Notification and Dashboard reclassification)
- governance/GD-PHASE2-CLOSURE-002.md (Position Management UI deferral)
- governance/GD-PHASE2-CLOSURE-003.md (D-005 provisional Phase 8 placement)
- governance/GD-PRE-M13-001.md (VAC-401 dual-path authority; COMPETITIVE_APPOINTMENT)
- governance/GD-PRE-M13-002.md (Position Linkage FTE Slot Model)
- governance/GD-M13-5.md (Position Skills/Certifications deferral; four prerequisites)
- governance/GD-M15-1.md (M15 Position Linkage — scope boundary and exclusions)
- directives/03_vacancy_management_rules.md (VAC-301, VAC-401, VAC-601, VAC-602)
- directives/10_role_based_access_rules.md (RBAC-700, RBAC-701)

---

# Context

## Phase 2 Closure and Post-Phase-2 Milestone Completion

Phase 2 — Workforce Core — closed formally on 2026-06-21 under
GD-PHASE2-CLOSURE-001, GD-PHASE2-CLOSURE-002, and GD-PHASE2-CLOSURE-003.

Three post-Phase-2 milestones have since been completed and CI-verified:

```text
M13 — Skills & Certifications Foundation     CI: 2026-06-19
M14 — Certification Expiration Tracking      CI: 2026-06-22  commit: 941c7be
M15 — Position Linkage                       CI: 2026-06-23  commit: 5ea8e84
```

All three Phase 2 success criteria are satisfied:

```text
Position Lifecycle Operational   — satisfied (M8, M15)
Vacancy Lifecycle Operational    — satisfied (M11)
Employee Management Operational  — satisfied (M12, M13, M14)
```

## Phase 3 as the Next Major Phase

`spec/15_implementation_roadmap.md` defines Phase 3 — Recruiting & Staffing — as
the next major implementation phase. Its deliverables are:

```text
Candidates
Applications
Interviews
Resume Upload
Resume Parsing
Hiring Workflow
```

Its success criteria are:

```text
Candidate Pipeline Operational
Hiring Workflow Operational
Employee Creation From Hire Operational
```

Phase 3 is the correct next phase. No alternative bridge phase is needed. The
pre-Phase-3 governance package is the bridge between Phase 2 completion and
Phase 3 implementation authority.

## Governance Gaps Requiring Resolution Before Implementation

Pre-Phase-3 inspection identified the following gaps that block implementation:

```text
1. spec/05 recruiting schema tables lack tenant_id (resumes, applications,
   interviews) — violation of SEC-003 that must be resolved before migration
2. spec/06 recruiting API contracts are stub-only (endpoint paths, no request
   bodies, no response contracts, no error codes, no RBAC per endpoint)
3. RBAC matrix in spec/06 conflicts with RBAC-700 directive on HR Director
   and Hiring Manager access to the Candidates domain
4. execution/04 Deliverable 8 (Notification Integration) is listed as Required
   but was reclassified to Phase 5 by GD-PHASE2-CLOSURE-001
5. execution/04 Deliverable 10 (Skill Matching Integration) is listed as
   Required but depends on Phase 4 Intelligence AI architecture not yet built
6. Application lifecycle state machine conflicts between execution/04 and
   spec/01 FR-304 — no authoritative set exists
7. The offers table does not exist in spec/05
8. Resume file storage infrastructure is unresolved
9. FR-152 Competency Framework has no phase assignment and no governing decision
10. Position Skills/Certifications (GD-M13-5) has two prerequisites still
    unresolved: spec/05 amendment and spec/06 amendment
```

This decision resolves the scope and execution/04 conflicts. Remaining gaps are
addressed by the required follow-up governance decisions listed in Decision 8.

---

# Decisions

## Decision 1 — Phase 3 Entry Status

Phase 3 — Recruiting & Staffing — is the next major implementation phase.

Phase 3 implementation is **not yet authorized**. The pre-Phase-3 governance
package must be approved before any Phase 3 implementation milestone begins.

A governance package is required, not a separate bridge implementation milestone.
The governance package produces GD documents only. The first implementation
milestone (M16) is authorized when the required governance decisions listed in
Decision 8 are approved.

---

## Decision 2 — Phase 3 Early Scope Definition

Early Phase 3 — covering M16 through the first group of Phase 3 milestones —
is scoped to the Recruiting & Staffing workflow foundation:

```text
Candidate Management
  — create, update, archive, search, view candidate records
  — candidate lifecycle enforcement
  — audit event trail

Application Management
  — application submission against a vacancy
  — application lifecycle enforcement
  — vacancy-to-application linkage
  — IN_RECRUITMENT vacancy state trigger (VAC-301)

Interview Workflow
  — schedule, reschedule, cancel, record outcome
  — interview type enforcement
  — interview history retention

Offer Workflow
  — create, approve, send, accept, decline, withdraw
  — offer lifecycle enforcement
  — approval workflow enforcement

Hire-to-Employee Conversion (VAC-401 Path B)
  — competitive appointment hire event
  — employee record creation with COMPETITIVE_APPOINTMENT (system-assigned)
  — vacancy → FILLED automation
  — remaining applications → CLOSED automation
  — positionId derived from vacancy's authorized position

Role Activation
  — Recruiter and Hiring Manager role surfaces activated for recruiting domain
  — governed by GD-PRE-PHASE3-003 (not by this decision)
```

This scope is provisional. Individual milestone scope lists are established
by their own governing decisions after the governance package is complete.

---

## Decision 3 — Explicit Exclusions from Early Phase 3

The following items are formally excluded from early Phase 3 scope:

### Notification Integration — Phase 5

Notification Integration (execution/04 Deliverable 8) is excluded from Phase 3.

This is not a new deferral. GD-PHASE2-CLOSURE-001 Decision 2 reclassified
Notification Integration to Phase 5 — Reporting & Compliance. execution/04
was not amended at that time. This exclusion brings execution/04 into
alignment with the prior governance decision.

No Phase 3 milestone may list "Notifications operational" as a success
criterion or exit gate.

The hiring workflow automation clause in execution/04 Deliverable 5 that states
"Generates Notifications" is superseded by GD-PHASE2-CLOSURE-001. Hire events
in Phase 3 must generate audit events; notification delivery is Phase 5.

### Workforce Dashboards and Reporting — Phase 5

Workforce Dashboards (including any "Hiring Dashboard," "Recruiting Dashboard,"
or "Executive Summary Dashboard") are excluded from Phase 3.

GD-PHASE2-CLOSURE-001 Decision 3 reclassified all Workforce Dashboards to
Phase 5. The "Hiring Dashboard" view listed under execution/04 Deliverable 7
(Recruiter Workspace) is subject to this classification. Recruiter Workspace
operational list views (Candidate Pipeline, Application Queue, Interview
Calendar, Offer Queue) are within Phase 3 scope. Metrics dashboards are not.

### AI Resume Parsing — Phase 4

FR-302 Resume Processing (structured AI extraction of skills, experience,
education, certifications from resumes) is excluded from early Phase 3.

FR-302 requires AI infrastructure. Phase 4 — Intelligence — is the correct
phase to establish AI infrastructure before AI-powered processing is built.

Resume metadata storage (filename, upload timestamp, parse status as a
placeholder field) may be within Phase 3 scope if governing schema decisions
are approved. AI parsing is not.

### AI Candidate Matching — Phase 4

FR-303 Candidate Matching (match score, skill gap analysis, position alignment
score, recommendation explanation) is excluded from early Phase 3.

execution/04 Deliverable 10 (Skill Matching Integration) lists FR-303
capabilities as Required. FR-303 is AI-powered. Building AI-powered candidate
matching before Phase 4 Intelligence establishes the AI architecture is
premature and architecturally incorrect.

execution/04 Deliverable 10 is amended by this decision: its Phase 3
classification is superseded. Skill Matching Integration is deferred to
Phase 4 — Intelligence, following the AI architecture milestone.

### D-005 Scheduling Domain — Phase 8 (Confirmed)

The D-005 Scheduling domain (FR-200, FR-202, FR-204) remains assigned to
Phase 8 — Scale & Evolution.

GD-PHASE2-CLOSURE-003 Decision 3 assigned D-005 to Phase 8 provisionally
pending project owner review at the next planning session (GD-PHASE2-CLOSURE-003
Decision 6). That review has now occurred.

**Project owner confirmation:** D-005 Scheduling is confirmed at Phase 8.
No D-005 implementation work should begin during Phase 3, Phase 4, Phase 5,
Phase 6, or Phase 7.

GD-PHASE2-CLOSURE-003 Decision 3 is no longer provisional. The "Pending
Project Owner Review" qualifier on GD-PHASE2-CLOSURE-003 Status is resolved
by this confirmation. No new governance decision is required to act on this
confirmation — the phase assignment in GD-PHASE2-CLOSURE-003 Decision 3
becomes unconditionally effective.

### FR-152 Competency Framework — Pending Separate Governance

FR-152 Competency Framework (competency models, proficiency levels, competencies
linked to positions) is excluded from early Phase 3.

FR-152 has no assigned phase and no governing decision. GD-M15-1 Scope Boundary
explicitly excluded FR-152 and required "GD-M13-5 complete + new GD" as
prerequisites. GD-M13-5 is not yet implemented.

FR-152 must not be included in any Phase 3 milestone until GD-PRE-PHASE3-004
assigns it a phase and defines implementation prerequisites. GD-PRE-PHASE3-004
is required governance (see Decision 8).

### Position Skills and Position Certifications — Pending Spec Amendments

Position Skills and Position Certifications (position_skills and
position_certifications tables and endpoints) are excluded from early Phase 3.

GD-M13-5 deferred this work and defined four prerequisites. Two are now
satisfied (M13 complete, M15 complete). Two are not yet satisfied:
(a) spec/05 amendment and (b) spec/06 amendment.

Position Skills and Position Certifications implementation must not begin
until a follow-up governance decision (GD-M13-5-FOLLOWUP, see Decision 8)
authorizes the spec amendments.

### Other Exclusions

The following items are also excluded from early Phase 3:

```text
User Management UI
Skills / Certifications / Department UI
Production Hardening
Next.js security advisory remediation (Phase 6)
JWT signature/expiry hardening (Phase 6)
Automated certification expiration job (not yet scoped)
```

---

## Decision 4 — execution/04 Governing Authority Amendment

`execution/04_phase_3_recruiting_and_staffing.md` contains two items whose
Phase 3 "Required" classification conflicts with prior governance decisions:

**Deliverable 8 — Notification Integration:**
Listed as "Required" in execution/04. Reclassified to Phase 5 by
GD-PHASE2-CLOSURE-001 Decision 2. This decision confirms that reclassification
applies to execution/04 as well as execution/03. execution/04 Deliverable 8 is
not a Phase 3 exit criterion.

**Deliverable 10 — Skill Matching Integration:**
Listed as "Required" in execution/04. FR-303 is AI-powered and requires Phase 4
Intelligence AI infrastructure. This decision supersedes execution/04 Deliverable
10's Phase 3 "Required" classification. Skill Matching Integration is deferred
to Phase 4.

Until execution/04 is formally amended, this governance decision governs over
execution/04 wherever the two conflict for Phase 3 planning purposes.
spec/15_implementation_roadmap.md remains the authoritative roadmap document
per GD-PHASE2-CLOSURE-001 Decision 1.

The amended effective Phase 3 success criteria (governed by spec/15 and this
decision) are:

```text
Candidate Pipeline Operational        (spec/15 Phase 3 criterion 1)
Hiring Workflow Operational           (spec/15 Phase 3 criterion 2)
Employee Creation From Hire Operational (spec/15 Phase 3 criterion 3)
Tests passing
```

"Notifications operational" and "Skill Matching operational" are not Phase 3
exit criteria under this governing authority.

---

## Decision 5 — Phase 2 Carryover Items Classification

The following items deferred from Phase 2 are classified as Phase 3 inputs
for planning purposes. They are not individually authorized for implementation
by this decision — implementation authority for each requires a specific
milestone scope decision.

```text
VAC-401 Path B — Competitive Appointment (GD-PRE-M13-001 D1)
  Phase 3 Milestone Target: Hire-to-Employee milestone (M18 or M19)
  Authority: GD-PRE-M13-001; hire event details governed by GD-PRE-PHASE3-002

IN_RECRUITMENT vacancy state trigger (VAC-301)
  Phase 3 Milestone Target: Application Management milestone (M17 or equivalent)
  Rule: first application received → vacancy OPEN → IN_RECRUITMENT

POS-301 position close vacancy cascade
  Phase 3 Milestone Target: Application Management milestone (same as IN_RECRUITMENT)
  Rule: closing a position auto-closes its open vacancies

Hiring Manager vacancy access (RBAC-700, RBAC-701)
  Phase 3 Milestone Target: Governed by GD-PRE-PHASE3-003
  Authority: RBAC-700 grants Hiring Manager candidate management access;
  per-endpoint specifics are a GD-PRE-PHASE3-003 decision

VAC-601 — Critical vacancy HR Director review requirement
  Phase 3 Milestone Target: Application or approval milestone
  Rule: Critical vacancies require HR Director review; requiresReview flag logic

VAC-602 — Manager Approval for CANCELLED vacancies
  Phase 3 Milestone Target: Application or approval milestone
  Rule: vacancy cancellation requires manager approval; "Manager" role
  definition is a GD-PRE-PHASE3-003 decision

Vacancy-to-Employee automation on hire
  Phase 3 Milestone Target: Hire-to-Employee milestone
  Scope: vacancy → FILLED; remaining applications → CLOSED; employee created;
  full automation contract governed by GD-PRE-PHASE3-002

Lifecycle approval gates / D-010 (second-approver gates)
  Phase 3 Milestone Target: Approval milestone (M17 or later)
  Scope: specific approval gate implementations governed by individual milestone
  scope decisions after the governance package is complete
```

---

## Decision 6 — Phase 3 Milestone Sequence (Indicative)

The indicative Phase 3 milestone sequence is:

```text
Pre-Phase-3 Governance Package    — governance documents only; no code
M16 — Candidate Management Foundation
  Backend: CandidateService + CandidateController
  Schema: recruiting.candidates (authorized by GD-PRE-PHASE3-002)
  RBAC: governed by GD-PRE-PHASE3-003
  No application, interview, offer, or hire workflow

M17 — Application and Vacancy Integration
  Backend: ApplicationService + ApplicationController
  Schema: recruiting.applications (authorized by GD-PRE-PHASE3-002)
  VAC-301 trigger; POS-301 cascade; VAC-601 review gate

M18 — Interview and Offer Management
  Backend: InterviewService + OfferService
  Schema: recruiting.interviews + recruiting.offers (authorized by GD-PRE-PHASE3-002)
  Offer lifecycle; offer approval workflow; VAC-602 manager approval

M19 — Hire-to-Employee (VAC-401 Path B)
  POST /applications/{id}/hire action
  COMPETITIVE_APPOINTMENT employee creation
  Full vacancy-to-employee automation

M20 — Phase 3 UI
  Recruiter Workspace frontend
  BFF route handlers
  Candidate pipeline, application queue, interview calendar, offer queue
```

This sequence is indicative. Individual milestone scope lists are established
by their own governing decisions and are not authorized by this document.
M16 is not authorized to begin until the required governance package decisions
listed in Decision 8 are approved.

---

## Decision 7 — Resume File Storage Classification

Resume file storage infrastructure (the storage backend for
`POST /api/v1/candidates/{id}/resume`) is excluded from early Phase 3 planning.

spec/06 explicitly defers this: "Deferred to Phase 3 planning. Resume file
storage infrastructure will be scoped when Phase 3 recruiting is implemented."

A governing decision on resume file storage infrastructure (S3-compatible object
storage, local filesystem, metadata-only with external reference) is required
before any Phase 3 milestone that includes resume upload can be implemented.

This infrastructure decision is added to the required follow-up governance list
in Decision 8 as an optional targeted GD or as an explicit decision within
GD-PRE-PHASE3-002. It must be resolved before any milestone that implements
`POST /api/v1/candidates/{id}/resume`.

Resume metadata storage (filename, upload timestamp, parsed_status as a
placeholder) may proceed without the infrastructure decision if the upload
endpoint is deferred.

---

## Decision 8 — Required Follow-Up Governance

This decision does not authorize Phase 3 implementation by itself.

The following governance decisions are required before M16 begins:

```text
GD-PRE-PHASE3-004   FR-152 Competency Framework Phase Assignment
                    — Required before Phase 3 to prevent informal scope creep
                    — Short; no Phase 3 implementation depends on it; approve first

GD-PRE-PHASE3-002   Candidate Domain Data Model, Schema Authority, Tenant Isolation
                    — Largest document; defines recruiting schema with corrected
                      tenant_id; defines offers table; defines status enums;
                      defines FK constraints; defines hire-to-employee contract
                    — Required before any schema migration can be written

GD-PRE-PHASE3-003   Recruiting RBAC Authority
                    — Per-endpoint RBAC matrix; Recruiter/Hiring Manager/HR Director
                      access; offer approval RBAC; audit event types
                    — Requires GD-PRE-PHASE3-002 schema to be defined first
```

Recommended approval order:

```text
1. GD-PRE-PHASE3-001 (this document)
2. GD-PRE-PHASE3-004 (FR-152 phase assignment — short, independent)
3. GD-PRE-PHASE3-002 (schema authority — largest document)
4. GD-PRE-PHASE3-003 (RBAC authority — depends on schema decisions)
```

Optional, not blocking M16:

```text
GD-M13-5-FOLLOWUP   Position Skills/Certifications Spec Amendment Authorization
                    — spec/05 and spec/06 amendments for position_skills and
                      position_certifications tables and endpoints
                    — Not blocking M16 (Position Skills/Certifications is not
                      early Phase 3 scope)
                    — Required before position_skills/certifications milestone
```

---

# Governing Authority Over

- execution/04_phase_3_recruiting_and_staffing.md (Phase 3 scope planning)
- Phase 3 implementation milestone scope decisions
- D-005 Scheduling roadmap placement (confirms and removes provisional qualifier
  from GD-PHASE2-CLOSURE-003 Decision 3)

---

# Impact on Existing Governance

| Decision | Status | Notes |
|---|---|---|
| GD-PHASE2-CLOSURE-001 | Unchanged | Notification/Dashboard Phase 5 classification extended to execution/04 by this decision |
| GD-PHASE2-CLOSURE-002 | Unchanged | Position Management UI delivered in M15 — complete |
| GD-PHASE2-CLOSURE-003 | Provisional status resolved | D-005 Phase 8 placement confirmed by project owner; Decision 3 is no longer provisional; Decision 6 pending review is closed by this confirmation |
| GD-PRE-M13-001 | Unchanged | VAC-401 Path B remains Phase 3 scope as classified; implementation authority remains with GD-PRE-PHASE3-002 |
| GD-M13-5 | Unchanged | Position Skills/Certifications prerequisites (c) and (d) now satisfied; (a) and (b) still required |
| GD-M15-1 | Unchanged | M15 scope boundary and exclusions remain in effect; FR-152 exclusion confirmed here |

---

Effective Date: 2026-06-27

Scope: Phase 3 entry conditions; execution/04 scope alignment; D-005 Scheduling
Phase 8 confirmation; Phase 2 carryover classification. Does not authorize any
implementation work, schema migration, application code change, or test baseline
change.

Implementation Not Authorized: No Phase 3 implementation milestone may begin
until GD-PRE-PHASE3-002 and GD-PRE-PHASE3-003 are approved.
