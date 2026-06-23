# Governance Decision: GD-PHASE2-CLOSURE-003
# D-005 Scheduling Domain — Phase Assignment and Roadmap Gap Resolution

Project: AI-Driven Staffing Optimization Platform for Government HR

Decision ID: GD-PHASE2-CLOSURE-003

Status: Approved — Pending Project Owner Review at Next Planning Session

Date: 2026-06-22

Approved By: Claude Code — Phase 2 Gap Resolution Governance

Milestone Context:
Post-Phase 2 — Governance Gap Closure

Depends On:
- GD-PHASE2-CLOSURE-001 (spec/15 authority hierarchy)
- GD-PHASE2-CLOSURE-002 (Phase 2 deferred items series precedent)
- GD-M12-2 (superseded in part — see Decision 2)
- GD-M12-5 (superseded in part — see Decision 2)

References:

- spec/15_implementation_roadmap.md (Phase 3, Phase 8 — Scale & Evolution)
- spec/01_requirements.md (FR-200, FR-202, FR-204 — Scheduling domain)
- spec/04_domain_model.md (Scheduling domain model — Schedule, Shift, Assignment)
- spec/05_database_schema.md (scheduling schema — schedules, shifts, assignments tables)
- spec/06_api_contracts.md (Scheduling API contracts)
- directives/04_scheduling_rules.md (Scheduling behavioral rules — authoritative)
- state/03_schedule_lifecycle.md (Schedule lifecycle states)
- governance/GD-M12-2.md (Employee Position Field Authority — incidental Phase 3 assumption)
- governance/GD-M12-5.md (Employee Availability Authority — incidental Phase 3 assumption)
- governance/GD-PRE-M13-002.md (Position Linkage FTE Slot Model — prerequisite for D-005)
- governance/GD-M13-5.md (Position Skills/Certifications — prerequisite for D-005)
- PROGRESS.md (D-005 Scheduling entry lines 4396–4419 — stale Phase 2 reference)

---

# Context

## The Gap

The D-005 Scheduling domain (FR-200 Schedule Creation, FR-202 Employee Assignment,
FR-204 Schedule Optimization) is fully specified across all blueprint layers:

```text
Requirements:    spec/01_requirements.md — FR-200, FR-202, FR-204
Domain Model:    spec/04_domain_model.md — Schedule, Shift, Assignment entities
Database Schema: spec/05_database_schema.md — scheduling.schedules, scheduling.shifts,
                                               scheduling.assignments tables
API Contracts:   spec/06_api_contracts.md — GET/POST /api/v1/schedules, publish, optimize
Frontend:        spec/09_frontend_architecture.md — /scheduling, /scheduling/calendars,
                                                     /scheduling/shifts
Backend Module:  spec/10_backend_architecture.md — Scheduling Module
Directive:       directives/04_scheduling_rules.md — full authoritative behavioral spec
State Lifecycle: state/03_schedule_lifecycle.md — DRAFT → SUBMITTED → APPROVED →
                                                   PUBLISHED → ARCHIVED
```

Despite full specification, D-005 has no assigned phase in spec/15_implementation_roadmap.md.
spec/15 Phase 8 is the only defined phase that accommodates future capabilities not required
for the initial production launch.

## Stale PROGRESS.md State

The PROGRESS.md D-005 entry (lines 4396–4419) as of 2026-06-22 contains two
factually incorrect statements:

**Line 4409 — Phantom execution plan reference:**
```
Execution Plan: Planned — execution/03_phase_2_core_workforce_platform.md
```
The file `execution/03_phase_2_core_workforce_platform.md` contains zero references
to Scheduling, D-005, FR-200, FR-202, or FR-204. The reference is a phantom.

**Line 4419 — Stale phase recommendation:**
```
Next Recommended Step: Implement FR-200 (Schedule Creation) in Phase 2 after
Employee and Workforce Planning domains are integrated
```
Phase 2 formally closed 2026-06-21 (GD-PHASE2-CLOSURE-001). This instruction points
to a closed phase and is not executable.

## Stale Governance Language

GD-M12-2 (2026-06-18) — Employee Position Field Authority — states:
```
position linkage deferred to Scheduling domain (Phase 3)
```

GD-M12-5 (2026-06-18) — Employee Availability Authority — states:
```
scheduling engine integration deferred to Phase 3
```

Both decisions used "Phase 3" as an informal working assumption for when the
Scheduling domain would be built. That assumption has never been formalized.
spec/15 Phase 3 is Recruiting (Candidates, Applications, Interviews, Resume Upload,
Resume Parsing, Hiring Workflow) and does not include D-005. The "Phase 3" language
in GD-M12-2 and GD-M12-5 is a planning placeholder, not an authoritative placement.

GD-PRE-M13-002 (2026-06-19) subsequently superseded GD-M12-2's position-linkage
mechanism (choosing positionId FK over scheduling.assignments). This further
decoupled D-005 from Phase 2 and Phase 3 planning.

## Phase 8 Placement Rationale

Phase 8 (Scale & Evolution) is spec/15's designated home for capabilities that are:
- Fully specified
- Not required for Phase 7 Production Launch success criteria
- Architecturally sound but operationally optional at launch

The Phase 7 Production Launch success criteria are:
```text
Production Stable
Users Active
Critical Workflows Operational
```

The core platform satisfies these criteria through Phases 1–6 (Foundation,
Workforce Core, Recruiting, Intelligence, Reporting & Compliance, Hardening).
D-005 workforce shift scheduling extends the platform's operational reach but
is not on the critical path to production launch.

FR-204 Schedule Optimization is explicitly AI-powered. Phase 8 placement means
FR-204 implementation follows Phase 4 Intelligence (where the AI architecture
is established), which is the correct sequencing for AI integration.

---

# Decisions

## Decision 1 — Phase 2 Formally Closed Without D-005

Phase 2 (Workforce Core) closed on 2026-06-21 without implementing D-005 Scheduling.

This is a factual record, not a retroactive failure. D-005 was never in any
Phase 2 milestone scope. The PROGRESS.md D-005 entry recommendation ("implement
in Phase 2") was aspirational planning language from initial spec authoring that
was never translated into a milestone plan or execution script.

No Phase 2 success criterion required D-005:
```text
Position Lifecycle Operational — satisfied (M8)
Vacancy Lifecycle Operational  — satisfied (M11)
Employee Management Operational — satisfied (M12)
```

## Decision 2 — Partial Supersession of GD-M12-2 and GD-M12-5

The incidental "Phase 3 Scheduling" language in GD-M12-2 and GD-M12-5 is
superseded for the purpose of D-005 phase placement only.

GD-M12-2 and GD-M12-5 remain fully authoritative for their own governing scope:
- GD-M12-2: No positionId on employee record in Phase 2. Still authoritative.
  The position-linkage-via-scheduling-assignments mechanism is already superseded
  by GD-PRE-M13-002.
- GD-M12-5: Employment status field is the Phase 2 availability representation.
  Still authoritative.

What is superseded: the informal assumption in both decisions that the Scheduling
domain (D-005) would be delivered in Phase 3. That assumption was never formalized
in spec/15 and is displaced by this decision.

The FR-112 scheduling engine integration deferral in GD-M12-5 remains in effect.
FR-112 acceptance criterion 2 ("Availability used by scheduling engine") is
dependent on D-005 existing. Its target phase follows from D-005's placement:
Phase 8.

## Decision 3 — D-005 Assigned to Phase 8 (Scale & Evolution)

The D-005 Scheduling domain (FR-200, FR-202, FR-204) is assigned to
Phase 8 — Scale & Evolution — per spec/15.

This assignment requires no spec/15 amendment. Phase 8 is the authoritative
future growth phase defined in spec/15 as "Ongoing" with scope "Future Capabilities."

D-005 joins Phase 8 alongside HRIS Integrations, Payroll Integrations,
Advanced Analytics, and other post-launch platform extensions.

**This placement is provisional pending project owner review (see Decision 6).**

## Decision 4 — "Required" Classification Retained With Clarification

The PROGRESS.md D-005 entry currently states:
```
Deliverable Status: Required
```

This classification is retained. "Required" means spec/01 defines D-005 as a
capability the platform must provide across its full lifecycle. It does not mean
required for Phase 7 Production Launch.

The distinction:
```text
Required for platform completeness:    YES — spec/01 FR-200, FR-202, FR-204 defined
Required for Phase 7 Production Launch: NO — Phase 7 success criteria satisfied
                                              without D-005
```

## Decision 5 — Implementation Prerequisite Chain

When D-005 Phase 8 implementation is planned, the following prerequisites must
be satisfied and verified:

```text
1. Position Linkage Milestone COMPLETE
   (GD-PRE-M13-002 — positionId on employees; POSITION_HAS_ACTIVE_INCUMBENT guard)
   Reason: scheduling.assignments links employees to shifts; meaningful shift
   assignment requires knowing which position an employee holds.

2. GD-M13-5 Position Skills/Certifications COMPLETE
   (position_skills and position_certifications tables and endpoints)
   Reason: shift scheduling should be aware of skill/certification requirements
   for a position when validating employee assignment eligibility.

3. Phase 4 Intelligence AI Architecture COMPLETE
   Reason: FR-204 Schedule Optimization is AI-powered; the optimization model
   should build on the Phase 4 AI infrastructure, not precede it.
```

No prerequisite blocks the governance decision itself. Prerequisites apply
to D-005 implementation planning, not to this roadmap assignment.

## Decision 6 — Pending Project Owner Review

This decision is issued to close the immediate governance gap (stale PROGRESS.md
reference, missing Deferred Items Register entry, undefined phase placement).

**The Phase 8 placement is provisional.** The project owner should review this
decision at the next planning session and may:

- Confirm Phase 8 placement if D-005 is not a near-term priority
- Reassign D-005 to an earlier phase (e.g., a post-Phase-3 milestone) if
  workforce scheduling is a higher operational priority than the current
  roadmap reflects
- Explicitly scope D-005 out of the current roadmap version if the platform
  is being scoped for an initial production launch without scheduling

A new governance decision must be issued to override Decision 3 of this document.
No implementation work on D-005 should begin until that review occurs and the
placement is either confirmed or revised.

---

# Impact on PROGRESS.md

This decision authorizes the following corrections to PROGRESS.md:

**D-005 Scheduling entry (lines 4396–4419):**

Line 4409 — Replace:
```
Execution Plan: Planned — execution/03_phase_2_core_workforce_platform.md
```
With:
```
Execution Plan: Not in current execution plan — no Phase 2 or Phase 3 execution
script exists for D-005; roadmap placement recorded in GD-PHASE2-CLOSURE-003
```

Line 4419 — Replace:
```
Next Recommended Step: Implement FR-200 (Schedule Creation) in Phase 2 after
Employee and Workforce Planning domains are integrated
```
With:
```
Next Recommended Step: Deferred to Phase 8 (Scale & Evolution) per
GD-PHASE2-CLOSURE-003 — pending project owner review at next planning session;
implementation prerequisite chain: Position Linkage Milestone → GD-M13-5 →
Phase 4 Intelligence AI architecture → D-005 Phase 8 implementation
```

**Deferred Items Register:**
Add D-005 row per Decision 3 of this document.

---

# Impact on Existing Governance

| Decision | Status | Notes |
|---|---|---|
| GD-M12-2 | Partially superseded (D-005 phase assumption only) | Position field authority for Phase 2 remains fully authoritative |
| GD-M12-5 | Partially superseded (D-005 phase assumption only) | Availability field authority for Phase 2 remains fully authoritative; FR-112 engine integration target phase updated to Phase 8 |
| GD-PRE-M13-002 | Unchanged | Position Linkage prerequisite for D-005 implementation confirmed |
| GD-M13-5 | Unchanged | Position Skills/Certifications prerequisite for D-005 implementation confirmed |

---

Effective Date: 2026-06-22

Scope: D-005 roadmap placement; PROGRESS.md D-005 entry correction authorization;
Deferred Items Register gap closure. Does not affect any implementation scope,
schema, migration, or test baseline.

Review Required: Project Owner — next planning session. Phase 8 placement is
provisional until confirmed or revised.
