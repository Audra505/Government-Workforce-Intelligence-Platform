# Governance Decision: GD-PHASE2-CLOSURE-001
# Phase 2 Exit Criteria Reconciliation — Notification Integration and Workforce Dashboards

Project: AI-Driven Staffing Optimization Platform for Government HR

Decision ID: GD-PHASE2-CLOSURE-001

Status: Approved

Date: 2026-06-21

Approved By: Product Owner — Phase 2 Formal Closure Governance

Milestone Context:
Phase 2 — Workforce Core — Formal Closure

References:

- spec/15_implementation_roadmap.md (Phase 2 Success Criteria; Phase 5 Deliverables)
- execution/03_phase_2_core_workforce_platform.md (Deliverables 5 and 8; exit criteria)
- PROGRESS.md (Phase 2 Blocking items recorded 2026-06-18 during M12 pre-implementation governance)

---

# Context

`execution/03_phase_2_core_workforce_platform.md` defines two Phase 2 deliverables that
have not been implemented in any Phase 2 milestone (M7 through M13):

- Deliverable 5: Workforce Dashboards — Department Dashboard, Position Dashboard,
  Vacancy Dashboard, Executive Summary Dashboard; metrics: Open Positions, Filled
  Positions, Open Vacancies, Vacancy Aging, Department Headcount.
- Deliverable 8: Notification Integration — Position Closure, Vacancy Creation,
  Vacancy Closure, Employee Assignment notifications.

Both deliverables are listed as Required in execution/03 and appear in its exit
criteria as "Dashboards operational" and "Notifications operational."

These two items were flagged on 2026-06-18 in PROGRESS.md as "Phase 2 Blocking"
with "Governance decision required before Phase 2 formal closure." No governance
decision was issued at that time. M13 has since been completed (2026-06-21) without
implementing either deliverable.

`spec/15_implementation_roadmap.md` is the authoritative implementation roadmap.
spec/15's own text states: "This document is authoritative for project execution."
Under spec/15:

- Phase 2 Success Criteria: Position Lifecycle Operational; Vacancy Lifecycle
  Operational; Employee Management Operational. Neither dashboards nor notifications
  appear in the Phase 2 success criteria.
- Phase 5 (Reporting & Compliance) deliverables include: Audit Events, Compliance
  Reports, Executive Dashboards, Workforce Reports, Recruiting Reports.
- Phase 5 Success Criteria include: Audit Trail Complete, Reports Exportable,
  Compliance Evidence Available.
- Notifications are Phase 5 scope ("Compliance Notifications" is a Phase 5
  deliverable).

execution/03 overstated Phase 2 scope relative to spec/15 by classifying Dashboards
and Notifications as Phase 2 Required deliverables. No Phase 2 success criterion in
spec/15 references either capability. The conflict must be formally resolved before
Phase 2 can be declared closed.

---

# Decisions

## Decision 1 — Authority Hierarchy

`spec/15_implementation_roadmap.md` governs over
`execution/03_phase_2_core_workforce_platform.md` wherever the two documents conflict
regarding Phase 2 exit scope.

Rationale: spec/15's own text establishes it as the authoritative project execution
document. Execution planning documents that expand scope beyond spec/15 Phase 2
success criteria require explicit governance authority. No such authority was granted
for Dashboards or Notifications as Phase 2 exit criteria.

## Decision 2 — Notification Integration Reclassification

Notification Integration is formally reclassified as a Phase 5 deliverable.

Notification Integration is not a Phase 2 exit criterion. The PROGRESS.md Phase 2
blocking record for Notification Integration dated 2026-06-18 is closed by this
decision. No Phase 2 milestone is required to implement notifications before Phase 2
can be declared formally closed.

Implementation target: Phase 5 — Reporting & Compliance, in conjunction with
compliance notification requirements (FR-153 alerting, FR-500 audit event delivery).

## Decision 3 — Workforce Dashboards Reclassification

Workforce Dashboards (Department Dashboard, Position Dashboard, Vacancy Dashboard,
Executive Summary Dashboard) are formally reclassified as Phase 5 deliverables.

The Vacancy Board list page at `/workforce/vacancies` is an operational list view
with status and priority filters. It satisfies Phase 2 Vacancy Management operational
requirements. It is not a metrics dashboard and does not satisfy any dashboard
deliverable requirement. No Phase 2 milestone is required to implement metrics
dashboards before Phase 2 can be declared formally closed.

Implementation target: Phase 5 — Reporting & Compliance, following Phase 4
(Intelligence) which must deliver forecasting and matching data before dashboard
metrics are meaningful.

## Decision 4 — execution/03 Scope Amendment

`execution/03_phase_2_core_workforce_platform.md` exit criteria are amended to
remove "Notifications operational" and "Dashboards operational" as Phase 2 gates.

The amended Phase 2 exit criteria under execution/03 are:

```text
Workforce CRUD complete             — SATISFIED (M7, M8, M11, M12, M13)
Lifecycle enforcement complete      — SATISFIED (all domains)
Audit logging operational           — SATISFIED (AuditService global; 42 event types)
Tests passing                       — SATISFIED (706 unit + 237+ e2e)
```

The execution/03 Required Frontend Pages section is governed by this decision and
GD-PHASE2-CLOSURE-002. Neither Dashboards nor Notifications are Required Phase 2
frontend pages.

---

# Impact

## Capabilities Not Affected

All Phase 2 operational capabilities are unaffected. This decision records a scope
reclassification only. No implementation is modified.

## Phase 5 Planning Inputs

The Phase 5 plan must include:

```text
Notification Integration:
  - Position Closure notification
  - Vacancy Creation notification
  - Vacancy Closure notification
  - Employee Assignment notification

Workforce Dashboards:
  - Department Dashboard (headcount, open positions, vacancy count)
  - Position Dashboard (fill rate, open vs filled, lifecycle distribution)
  - Vacancy Dashboard (aging, priority distribution, closure outcomes)
  - Executive Summary Dashboard (aggregate workforce metrics)
```

---

# Spec Deviation

None.

This decision aligns the execution plan with spec/15, which is the higher-authority
document. No spec/15 deliverable is removed; Dashboards and Notifications are
retained as Phase 5 deliverables exactly where spec/15 places them.

---

Effective Date: 2026-06-21

Scope: Phase 2 formal closure. Governs PROGRESS.md blocking record resolution and
execution/03 exit criteria amendment. Does not affect Phase 5 scope, planning, or
implementation authority.
