# Governance Decision: GD-PHASE2-CLOSURE-002
# Position Management UI — Formal Deferral to Position Linkage Milestone

Project: AI-Driven Staffing Optimization Platform for Government HR

Decision ID: GD-PHASE2-CLOSURE-002

Status: Approved

Date: 2026-06-21

Approved By: Product Owner — Phase 2 Formal Closure Governance

Milestone Context:
Phase 2 — Workforce Core — Formal Closure

Depends On: GD-PHASE2-CLOSURE-001 (authority hierarchy decision)

References:

- spec/15_implementation_roadmap.md (Phase 2 UI Deliverables; Phase 2 Success Criteria)
- governance/GD-PRE-M13-002.md (Position Linkage FTE Slot Model — all decisions)
- governance/GD-PRE-M13-001.md (VAC-401 Dual-Path — position assignment context)
- governance/GD-PRE-M13-003.md (DEP-008 Phase B — position constraint at linkage)
- directives/02_position_management_rules.md (POS-400 and POS-500 series)
- state/01_position_lifecycle.md (position lifecycle and closure pre-conditions)

---

# Context

`spec/15_implementation_roadmap.md` Phase 2 UI deliverables list:

```text
Position Management
Vacancy Management
Employee Directory
```

No position management pages exist in `apps/web/src/app/`. The web application
currently has no frontend route for viewing or managing the position catalog.

Position Management backend is fully implemented and verified:

- 5 NestJS endpoints: POST, GET (list), GET (by ID), PATCH, POST /close
- 4-state lifecycle: DRAFT / ACTIVE / FROZEN / CLOSED enforced at service layer
- POS-AUTH-001 through POS-AUTH-005 RBAC enforced
- AUD-400 audit events emitted (CREATED, UPDATED, ACTIVATED, FROZEN, CLOSED)
- POS-500 "No Active Vacancies" gate enforced (M11 Step 8)
- SEC-003 tenant isolation enforced
- 244 unit tests + 39 e2e tests passing

Position Management UI was not built in any Phase 2 milestone because the core
employee-to-position occupancy mechanism it depends on — the 1:1 FTE Slot Model
established in GD-PRE-M13-002 — was explicitly deferred beyond M13. Position UI
built today would be structurally incomplete and would require 40–60% rework when
GD-PRE-M13-002 is implemented.

---

# Decisions

## Decision 1 — Formal Deferral to Position Linkage Milestone

Position Management UI (spec/15 Phase 2 UI deliverable) is formally deferred to the
Position Linkage Milestone, which implements GD-PRE-M13-002.

The spec/15 Phase 2 success criterion "Position Lifecycle Operational" is satisfied
by the operational backend layer. The UI deliverable is deferred; the success
criterion is not.

## Decision 2 — Deferral Rationale

The following specific dependencies make building Position Management UI before
GD-PRE-M13-002 incorrect engineering:

### Dependency A — Occupant Display

A position detail page must display the current occupant employee. This requires:

```text
- employees.position_id column (GD-PRE-M13-002 Decision 2: nullable at creation;
  required at ACTIVE transition)
- Service-layer occupancy query using the 1:1 FTE Slot Model constraint
  (GD-PRE-M13-002 Decision 1: at most one non-SEPARATED employee per position)
```

Neither the column nor the service method exists. A position detail page built today
cannot show its occupant. This misrepresents the Position domain to users.

### Dependency B — Position Close Guard (POSITION_HAS_ACTIVE_INCUMBENT)

GD-PRE-M13-002 Decision 5 requires that position closure is blocked when one or more
employees in PENDING_ONBOARDING, ACTIVE, ON_LEAVE, or SUSPENDED status hold a
positionId reference to the target position. Error code: POSITION_HAS_ACTIVE_INCUMBENT.

This guard is not yet implemented in PositionService because the employees.position_id
column does not exist. A "Close Position" UI action built today will succeed in cases
it should reject after position linkage. This creates a UI behavioral discrepancy that
must be corrected in the Position Linkage milestone.

### Dependency C — Position Assignment Workflow

The employee-to-position assignment workflow — setting positionId on an employee
record — requires the position linkage endpoint and data model defined in
GD-PRE-M13-002 Decision 2 and Decision 3 (position assignment permitted only when
position is ACTIVE; positionId must be set before ACTIVE transition). No position
assignment UI surface can exist before this endpoint exists.

### Dependency D — POS-500 Full Enforcement

PositionService.closePosition() currently enforces the "No Active Vacancies"
sub-condition (POS-500 partial, active since M11 Step 8). The "No Active Employees"
sub-condition (GD-PRE-M13-002 Decision 5) cannot be implemented or exercised through
any UI until employees carry positionId references.

## Decision 3 — Position Linkage Milestone Binding Requirement

The Position Linkage Milestone, when planned, MUST deliver a complete Position
Management UI surface including:

```text
Position list page
  — searchable/filterable by status, department, classification
  — links to position detail

Position create page
  — title, department, classification, salary band, status

Position detail page
  — all fields
  — current occupant display (name, employee number, status, hireDate)
  — lifecycle action controls (Activate, Freeze, Close) gated by canWrite
  — POSITION_HAS_ACTIVE_INCUMBENT error surfaced on close attempt
  — POSITION_HAS_ACTIVE_VACANCIES error surfaced on close attempt (existing guard)

Position edit page
  — all mutable fields; status not editable via edit form (lifecycle actions only)

Position lifecycle actions
  — DRAFT → ACTIVE transition (Activate)
  — ACTIVE → FROZEN transition (Freeze)
  — ACTIVE/FROZEN → CLOSED transition (Close) with full POS-500 enforcement
```

This requirement is binding on Position Linkage Milestone planning. It may not be
deferred to a subsequent milestone without a new governance decision.

## Decision 4 — No Provisional Position UI

No provisional, partial, or placeholder position UI pages shall be added to
`apps/web/src/app/` before the Position Linkage Milestone.

A stub position UI that omits the occupant display or cannot enforce
POSITION_HAS_ACTIVE_INCUMBENT is more damaging than no UI. It creates user-visible
behavior that will change materially when position linkage is implemented, violating
ROADMAP-003 (operational readiness before production).

## Decision 5 — Existing Position Read Access

The Create Vacancy form at `/workforce/vacancies/new` already surfaces ACTIVE
positions via `GET /api/v1/positions?status=ACTIVE`. Authorized users creating
vacancies have read access to ACTIVE position records through this interaction.
This is not a substitute for Position Management UI but reduces the operational
impact of the UI deferral for the primary vacancy creation workflow.

---

# Impact on Phase 2 Closure

The Phase 2 spec/15 success criterion "Position Lifecycle Operational" is fully
satisfied by the backend:

```text
Position Lifecycle Operational — SATISFIED
  Evidence:
  - 5 endpoints operational (POST, GET list, GET by ID, PATCH, POST /close)
  - 4-state lifecycle enforced at service layer
  - POS-AUTH-001–005 RBAC enforced
  - POS-500 "No Active Vacancies" gate active (M11 Step 8)
  - 244 unit tests + 39 e2e tests passing
  - AUD-400 audit events all verified
```

Phase 2 may be formally closed under the "PHASE 2 COMPLETE WITH DEFERRED ITEMS"
classification. The Position Management UI is a governed deferred item.

---

# Spec Deviation

The spec/15 Phase 2 UI deliverable "Position Management" is deferred to the
Position Linkage Milestone.

Deviation authority: this decision (GD-PHASE2-CLOSURE-002).

Deviation justification:
- The position occupancy display (primary UI value) requires GD-PRE-M13-002 mechanism
- Building a UI that cannot show occupancy or enforce POSITION_HAS_ACTIVE_INCUMBENT
  is an incomplete deliverable, not a Phase 2 UI deliverable
- All three spec/15 Phase 2 success criteria are satisfied; the UI deliverable is a
  separate artifact from the operational success criterion
- 40–60% rework to the Position detail and close-action surface is avoided
- The Position Linkage Milestone planning requirement (Decision 3) ensures the UI
  is delivered correctly and completely in the correct dependency order

---

Effective Date: 2026-06-21

Scope: Phase 2 formal closure. Position Linkage Milestone planning constraint.
Position Management UI may not be implemented until the Position Linkage Milestone
is planned and approved.
