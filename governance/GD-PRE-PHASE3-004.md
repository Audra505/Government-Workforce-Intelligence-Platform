# Governance Decision: GD-PRE-PHASE3-004
# FR-152 Competency Framework — Phase Assignment and Early Phase 3 Exclusion

Project: AI-Driven Staffing Optimization Platform for Government HR

Decision ID: GD-PRE-PHASE3-004

Status: Approved

Date: 2026-06-27

Approved By: Product Owner — Pre-Phase-3 Governance Review

Milestone Context:
Pre-Phase-3 governance recording. Assigns FR-152 Competency Framework to a
future phase and formally excludes it from early Phase 3 Recruiting & Staffing
implementation. Required predecessor to GD-PRE-PHASE3-002 and GD-PRE-PHASE3-003.

References:

- spec/01_requirements.md — FR-152 Competency Framework (requirement definition)
- spec/15_implementation_roadmap.md — Phase 3 (Recruiting & Staffing), Phase 4
  (Intelligence), phase success criteria
- governance/GD-M13-5.md — Position Skills/Certifications deferral; position-level
  skill and certification requirement modeling
- governance/GD-M15-1.md — M15 Scope Boundary; FR-152 explicitly excluded
- governance/GD-PRE-PHASE3-001.md — Phase 3 Scope Boundary; FR-152 exclusion from
  early Phase 3; GD-PRE-PHASE3-004 listed as required prerequisite governance
- directives/10_role_based_access_rules.md — RBAC-700 (Recruiter/Hiring Manager
  candidate management access)

---

# Background

## FR-152 in the Requirements Specification

`spec/01_requirements.md` defines FR-152 Competency Framework as follows:

```text
Description:
System shall support competency models.

Inputs:
- Competency
- Proficiency Level
- Evaluation Criteria

Acceptance Criteria:
- Competencies maintained.
- Competencies linked to positions.
```

FR-152 sits within the Workforce Management domain in spec/01. It is a
capability the platform must ultimately deliver. It is not currently
implemented in any phase.

## Current Implementation State

FR-152 has no implementation footprint in the repository:

```text
spec/05 — No competency table defined
spec/06 — No competency endpoint defined
spec/04 — No competency entity in domain model
directives/ — No competency management rules directive
state/ — No competency lifecycle document
execution/ — No execution plan covers FR-152 implementation
```

## Prior Governance Exclusions

FR-152 has been formally excluded from two prior implementation milestones:

**GD-M15-1 (2026-06-22) — M15 Scope Boundary:**
FR-152 Competency Framework was explicitly listed in the M15 scope boundary
exclusions with the note: "no governance decision issued; prerequisite:
GD-M13-5 complete + new GD."

**GD-PRE-PHASE3-001 (2026-06-27) — Phase 3 Scope Boundary:**
FR-152 was excluded from early Phase 3 scope with the following condition:
"FR-152 must not be included in any Phase 3 milestone until GD-PRE-PHASE3-004
assigns it a phase and defines implementation prerequisites."

This decision satisfies that condition.

## Relationship to GD-M13-5 Position Skills/Certifications

GD-M13-5 deferred Position Skills and Position Certifications tables and
endpoints with four defined prerequisites. One of FR-152's acceptance criteria
is "Competencies linked to positions." This creates a natural prerequisite
chain: before competencies can be linked to positions at the data level,
positions must already carry their skill and certification requirements
(GD-M13-5 implementation). A competency framework built before position
skill/certification modeling exists would link to an incomplete position
model.

GD-M13-5 prerequisites (a) spec/05 amendment and (b) spec/06 amendment
remain unresolved. FR-152 implementation cannot meaningfully precede GD-M13-5
completion.

---

# Decisions

## Decision 1 — Phase Assignment

FR-152 Competency Framework is assigned to Phase 4 — Intelligence.

Rationale:

```text
1. Competency models are primarily inputs to matching and optimization.
   The primary consumer of competency data in this platform is candidate
   matching (FR-303) and position alignment scoring — both Phase 4
   Intelligence capabilities. Building the competency framework before the
   intelligence layer exists produces data structures with no runtime
   consumer.

2. Phase 4 Intelligence establishes the AI architecture. FR-152 competency
   models feed directly into skill gap analysis, candidate match scoring,
   and position alignment recommendations. Implementing competency models
   after Phase 4 architecture is in place ensures they are designed to
   integrate correctly with the AI module from the start.

3. Position linkage is a prerequisite. FR-152 acceptance criterion
   "Competencies linked to positions" requires positions to carry their own
   skill and certification requirements first (GD-M13-5). GD-M13-5
   implementation is most naturally timed in early Phase 3 or Phase 4
   preparation. FR-152 follows, not precedes, that work.

4. Phase 3 Recruiting workflow does not require competency models.
   Candidates, applications, interviews, offers, and hire-to-employee
   conversion — the entire Phase 3 workflow — can be implemented and operate
   at full fidelity without FR-152. No Phase 3 success criterion references
   competency data.
```

This phase assignment requires no spec/15 amendment. Phase 4 — Intelligence
is the designated home for capabilities that consume or produce intelligence
inputs. FR-152 competency models are intelligence inputs.

---

## Decision 2 — Exclusion from Early Phase 3

FR-152 is formally and explicitly excluded from all early Phase 3 milestones,
including M16 (Candidate Management Foundation), M17 (Application and Vacancy
Integration), M18 (Interview and Offer Management), M19 (Hire-to-Employee),
and M20 (Phase 3 UI).

No Phase 3 milestone may include:

```text
Competency table creation (competencies table or equivalent)
Competency API endpoints (GET/POST /api/v1/competencies or equivalent)
Position competency linkage tables (position_competencies or equivalent)
Candidate competency linkage tables
Competency UI pages
Competency directives or behavioral rules
```

If a future Phase 3 milestone scope includes any FR-152 implementation, a new
or amended governance decision must explicitly authorize that deviation from
this exclusion. This decision does not authorize any such inclusion.

---

## Decision 3 — FR-152 Is Not a Phase 3 Blocker

Phase 3 Recruiting & Staffing can proceed without FR-152.

FR-152 is not a blocker for any of the following Phase 3 capabilities:

```text
Candidate Management Foundation (M16)
Application Management and Vacancy Integration (M17)
Interview and Offer Management (M18)
Hire-to-Employee Conversion — VAC-401 Path B (M19)
Phase 3 Recruiter Workspace UI (M20)
```

Phase 3 success criteria per spec/15 are:

```text
Candidate Pipeline Operational
Hiring Workflow Operational
Employee Creation From Hire Operational
```

None of these criteria depend on competency models. Phase 3 can be completed
and its success criteria satisfied with FR-152 fully absent.

M16 remains blocked only by GD-PRE-PHASE3-002 (schema authority) and
GD-PRE-PHASE3-003 (RBAC authority). This decision does not affect that
blocking status — it resolves the FR-152 open thread independently and
does not authorize implementation on its own.

---

## Decision 4 — Implementation Is Not Authorized by This Decision

This decision assigns FR-152 a target phase and prevents unauthorized scope
creep into Phase 3. It does not authorize any implementation work.

Before FR-152 implementation begins in Phase 4, future governance must define:

```text
Competency Data Model
  — what a competency is: name, category, proficiency levels, evaluation criteria
  — whether competencies are per-tenant or global catalog
  — soft-delete strategy; versioning strategy

Relationship to Positions
  — position_competencies table structure
  — how competency requirements differ from skill requirements (GD-M13-5)
  — required vs preferred classification

Relationship to Skills and Certifications
  — whether competencies are a layer above skills/certifications or orthogonal
  — how GD-M13-5 position_skills/position_certifications interact with
    position_competencies at the query layer

Relationship to Candidate Matching
  — how FR-153-era competency data flows into FR-303 candidate match scoring
  — whether competency gap is a match dimension alongside skill gap

API Contracts
  — full request/response contracts for competency CRUD endpoints
  — pagination strategy; filter strategy
  — assignment endpoint design for position_competencies

RBAC
  — which roles may create and manage competency catalog entries
  — which roles may link competencies to positions
  — which roles may view competency reports

Audit Events
  — new AuditEventType values following GD-M13-4 pattern

Tenant Isolation
  — tenant_id on all competency-related tables (SEC-003 applies)
  — competency catalog scope: per-tenant or shared
```

A governance decision must authorize the spec/05 schema amendment and the
spec/06 API contract amendment before any implementation begins.

---

## Decision 5 — Prerequisite Chain

FR-152 implementation in Phase 4 has the following prerequisite chain:

```text
1. GD-M13-5-FOLLOWUP — Position Skills/Certifications spec amendments
   (spec/05 and spec/06) must be authorized and the position_skills /
   position_certifications tables and endpoints must be implemented.
   Reason: FR-152 acceptance criterion "Competencies linked to positions"
   builds on top of the position skill/certification model.

2. Phase 4 Intelligence AI architecture milestone must define the AI module
   structure before FR-152 competency data is designed to feed into it.
   Reason: Competency models that must integrate with AI matching should
   be structured to match the AI module's data contract, not designed
   independently and adapted later.

3. A dedicated FR-152 governing decision must authorize the competency
   schema, API contracts, RBAC matrix, and audit events as defined in
   Decision 4 above.
```

No prerequisite blocks this governance decision. Prerequisites apply to
FR-152 implementation planning, not to this phase assignment.

---

# Impact on Phase 3

FR-152 exclusion from Phase 3 has no negative impact on Phase 3 deliverables
or success criteria.

Phase 3 candidate records may carry skills and certifications imported from
resumes or manually entered. This data uses the workforce.skills and
workforce.certifications catalog established in M13 and the employee-level
junction tables from M13. Position-level skill/certification requirements
are a GD-M13-5 deliverable. FR-152 competency modeling is a layer built
on top of both, and is not needed for Phase 3 recruiting workflow operation.

---

# Impact on Existing Governance

| Decision | Status | Notes |
|---|---|---|
| GD-M15-1 | Unchanged | M15 FR-152 exclusion confirmed; this decision provides the "new GD" referenced in GD-M15-1 scope boundary note |
| GD-PRE-PHASE3-001 | Satisfied | GD-PRE-PHASE3-004 was listed as required prerequisite; issuing this decision satisfies that requirement |
| GD-M13-5 | Unchanged | Position Skills/Certifications prerequisites unaffected; FR-152 follows GD-M13-5 in the implementation sequence |

---

Effective Date: 2026-06-27

Scope: FR-152 phase assignment to Phase 4 Intelligence; explicit exclusion
from all early Phase 3 milestones. Does not authorize any implementation work,
schema creation, API endpoint creation, migration, UI development, directive
authoring, or test baseline change for the Competency Framework domain.
