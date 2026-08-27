# M35 — Human-in-the-Loop Workforce Command Center Blueprint

Companion design document to `governance/GD-M35-1.md`.

Status: Completed — Blueprint/Governance Deliverable (documentation and governance only; no implementation authorized).

Date: 2026-08-26

**This document describes a target design. It does not describe anything
currently running, seeded, migrated, or deployed. Every entity, endpoint,
and UI surface named below is a future-tense design proposal, gated by its
own future governance decision per `GD-M35-1` Decision 1 and Decision 15.**

---

## 1. Current-State Summary

Verified directly against the repository as of this milestone:

- **Authorization:** Seven role-name strings (`System Administrator`, `HR
  Director`, `Workforce Planner`, `Recruiter`, `Hiring Manager`,
  `Compliance Officer`, `Executive User`) enforced by `@RequireRoles(...)`
  and `RolesGuard` (`apps/api/src/identity/roles.guard.ts`), matched
  against `req.user.roles: string[]` populated from the JWT
  (`apps/api/src/identity/auth.service.ts`). The JWT payload's own inline
  comment states permission-based loading was "deferred to Phase 2" and
  was never implemented.
- **Permission model:** `Permission` and `RolePermission` tables exist in
  `apps/api/prisma/schema.prisma` (identity schema), matching
  `directives/10`'s `resource:action` pattern exactly. Confirmed dormant:
  zero `Permission` rows are seeded by `apps/api/prisma/seed.ts`, and no
  runtime query against either table exists anywhere in `apps/api/src`.
- **Role seeding:** `seed.ts` seeds seven `Role` rows (name + description)
  and one dev fixture user per non-SA role (`hrd@dev.gov`, `wp@dev.gov`,
  `recruiter@dev.gov`, `hm@dev.gov`, `co@dev.gov`, `exec@dev.gov`), plus
  the System Administrator dev seed user (`admin@dev.gov`). All upserts
  are idempotent.
- **Frontend navigation:** Centralized in
  `apps/web/src/components/shared/platform-header.tsx`, which computes
  nav visibility from the same role-name array — a reusable pattern for a
  future capability-based equivalent.
- **Intelligence:** Five deterministic, non-LLM signals (Vacancy Risk,
  Workforce Readiness, Attrition Risk, Department Gap, Executive Metrics),
  all sharing the `IntelligenceExplainabilityOutput` contract, all
  aggregate-only where they touch employee-level data, all audited, all
  carrying a mandatory human-review advisory. No LLM/OpenAI call exists
  anywhere in the codebase.
- **Audit:** `apps/api/src/audit/audit.service.ts`'s `logEvent()` is
  write-only. It wraps its `create()` call in try/catch; on failure it
  logs via `Logger.error` and returns normally — no retry, no dead-letter,
  no rethrow. No `AuditController` or audit-read endpoint of any kind
  exists in the repository.
- **Hire endpoint RBAC conflict (confirmed in code):**
  `apps/api/src/recruiting/hire.controller.ts:57` enforces
  `@RequireRoles('System Administrator', 'HR Director')`, per `GD-M19-1`.
  `directives/10_role_based_access_rules.md` RBAC-701 states "Hiring
  approval requires: Hiring Manager, HR Director" — a different set that
  excludes System Administrator and includes Hiring Manager, which the
  hire endpoint does not grant at all.
- **Search:** `spec/01_requirements.md` FR-850/851/852 require a global,
  permission-controlled search across Employees, Positions, Vacancies,
  Candidates, Forecasts, and Reports. No search implementation exists
  anywhere in the frontend or backend.
- **Recruiting/hiring/intelligence/admin implementation:** All fully
  functional and CI-confirmed through M34 (`0d0ef60`); two further local
  commits are runtime/browser-verified but unpushed. Recruiting covers
  candidates through hire-to-employee conversion. Admin covers user and
  department management. None of this is disposable — see Section 16
  (Preserved Capabilities).
- **Testing:** The seven role names are hardcoded across at least 22
  backend unit spec files and 12 backend e2e spec files, plus every
  recruiting controller's route-level `@RequireRoles` decorators. No
  committed, CI-gated E2E/Playwright suite exists for any milestone
  through M34 — every "browser verification" to date has been ad hoc and
  uncommitted.

---

## 2. Target Operating Model

One sign-in experience. One unified Workforce Command Center as the
primary decision-facing surface. The existing Dashboard, Intelligence,
Workforce, Recruiting, and Admin shells remain the deterministic
operational and execution substrate beneath the Command Center — approved
actions execute through these existing, already-governed surfaces, not
through a new parallel write path.

```text
                 ┌─────────────────────────────┐
                 │   Workforce Command Center    │   ← new decision-facing
                 │ (decision packets, approvals, │     surface (M43+)
                 │  Search, oversight views)     │
                 └───────────────┬───────────────┘
                                 │ approved actions only
                                 ▼
   ┌───────────┬───────────┬───────────┬───────────┬───────────┐
   │ Dashboard │Intelligence│ Workforce │ Recruiting│   Admin   │  ← existing,
   │  (M23+)   │  (M30-34)  │  shell    │   shell   │  shell    │    unchanged,
   └───────────┴───────────┴───────────┴───────────┴───────────┘    governed
```

---

## 3. Two-Profile Model

### Workforce Decision Owner

Primary daily operator profile. Composed from capability groupings drawn
from the current HR Director, Workforce Planner, Recruiter, and Hiring
Manager roles' capabilities. Prepares and approves Tier 1 (routine) and
Tier 2 (maker-checker) decisions. Does not have standing Independent
Oversight Reviewer capability.

### Independent Oversight Reviewer

Compliance/oversight and elevated-risk second-approval profile. Purpose-
built, not a union of Compliance Officer and Executive User access.

**Sees:**
- Compliance reviews, findings, and exceptions
- High-risk decision packets requiring oversight
- Relevant evidence and policy evaluations (case-scoped, PII-minimized)
- Privileged-access and elevation activity
- Approval, execution, and verification history
- Aggregate executive-risk information
- Tenant-scoped audit history

**Approves:**
- Compliance and policy exceptions
- Failed-control overrides
- Privileged or emergency access
- Consequential policy or security-configuration changes
- Elevated-risk actions requiring independent oversight (Section 7, Tier 3)

**Does not approve:**
- Routine recruiting
- Normal candidate progression
- Routine workforce planning
- Every ordinary hire (only hires that independently trigger a Tier 3
  condition escalate to this profile)

---

## 4. Temporary Administrator Elevation Model

Replaces a permanent daily System Administrator persona. Design fields:

| Field | Purpose |
|---|---|
| `requestedBy` | The human requesting elevation |
| `reason` | Free-text or categorized justification, mandatory |
| `approvedBy` | A distinct human approver — self-elevation without independent approval is disallowed for anything beyond a defined low-risk tier |
| `grantedPermissions` | The scoped permission set granted, never a blanket "all SA permissions" grant by default |
| `expiresAt` | Mandatory expiry; no indefinite elevation |
| `stepUpAuthMethod` | Re-authentication proof beyond the standing session (e.g., re-entered credential, second factor) |
| `revokedAt` | Optional early revocation |
| Full audit trail | Every request, approval, grant, use, and expiry/revocation is an audit event |

**No automatic PII entitlement (binding):** temporary System Administrator
elevation does not grant blanket employee or candidate PII access of any
kind. `grantedPermissions` must never default to including employee- or
candidate-level personally identifiable information. Any elevation request
that genuinely requires PII-scoped access must independently justify that
need in `reason`, must be narrowly scoped to only the specific records
required, and remains fully subject to the case-scoped, PII-minimized
evidence-access principle established in `GD-M35-1` Decision 10 — elevation
is never a mechanism for bypassing that principle.

**Sequencing constraint (binding):** this model may be *built* (M37) before
the audit prerequisite (Section 12 / M39) is complete, but must not be
*activated for production use* until M39 is operational. An elevation
mechanism without a working, reviewable audit trail is a net new risk, not
a safety improvement, over today's permanent SA fixture.

---

## 5. Seven-Role Migration Plan

```text
Phase A (current state):
  Seven roles are the only assignable identities. Unchanged by M35.

Phase B (M36):
  PermissionsGuard introduced, running in PARALLEL with RolesGuard.
  No live-endpoint behavior change. Permission/RolePermission rows seeded
  to mirror current role capabilities exactly.

Phase C (M36, continued):
  Capability-parity proof: for every existing endpoint and every one of
  the seven roles, PermissionsGuard must produce an identical HTTP
  authorization outcome to RolesGuard. The 22 backend spec files + 12
  e2e spec files that hardcode role names today become this proof's
  regression baseline.

Phase D (M38+):
  New Command Center capabilities (decision cases, approvals) are built
  against the permission model, not the role-string model, from the
  start.

Phase E (M46):
  Real user assignments begin migrating from the seven legacy roles to
  the two authority profiles (Workforce Decision Owner, Independent
  Oversight Reviewer) plus elevation. Migration proceeds only after
  Phase C's parity proof is reviewed and approved.

Phase F (post-M46, ongoing):
  Direct production assignment of the seven legacy role names is retired.
  The seven names are preserved permanently as (a) internal capability-
  grouping vocabulary, and (b) the compatibility/regression test baseline
  — never deleted, per GD-M35-1 Decision 5.
```

No phase in this plan deletes or disables the seven roles' current
behavior before its replacement is proven equivalent.

---

## 6. Capability Matrix Draft

Indicative only — final composition is an M36 deliverable, not fixed here.

| Legacy role | Primary target profile | Notes |
|---|---|---|
| HR Director | Workforce Decision Owner (HR authority) | Also a Tier 2 maker-checker participant |
| Workforce Planner | Workforce Decision Owner | Forecast/plan preparation; self-review rule applies if also approving |
| Recruiter | Workforce Decision Owner | Candidate/application/interview/offer preparation |
| Hiring Manager | Workforce Decision Owner (department/hiring authority) | Tier 2 maker-checker participant, department side |
| Compliance Officer | Independent Oversight Reviewer (partial) | Compliance findings/exceptions capability only — not a full inheritance |
| Executive User | Independent Oversight Reviewer (partial) | Aggregate executive-risk visibility only — not a full inheritance |
| System Administrator | Temporary elevation (not a standing profile) | No standing daily-use profile; access granted only via elevation session |

**Explicit constraint:** Independent Oversight Reviewer's grant is the
union of only the specific capabilities named in Section 3, drawn
selectively from Compliance Officer and Executive User — not an automatic
union of everything either role can currently do.

---

## 7. Tiered Approval Model

Three distinct tiers, never conflated:

```text
Tier 1 — Routine, single-human approval
  Actor: any authorized Workforce Decision Owner
  Applies to: candidate movement, drafting, analysis, scenario
  preparation, information requests, routine AI-supported actions
  Approvers required: 1

Tier 2 — Workforce Decision Owner maker-checker approval
  Actors: one department/hiring authority + one HR authority, both
  within the Workforce Decision Owner population, distinct individuals
  Applies to: routine final offer authorization, routine hire
  authorization
  Approvers required: 2 (both Workforce Decision Owner population;
  Independent Oversight Reviewer NOT a standing participant)

Tier 3 — Independent Oversight Reviewer approval
  Actor: Independent Oversight Reviewer
  Applies to: only cases triggering an elevated-risk condition (the
  elevated-risk condition list in GD-M35-1 Decision 13, reproduced
  below): compliance exceptions, failed-control overrides,
  privileged/emergency access, authorization/policy/security-configuration
  changes, self-prepared forecast/plan activation, sensitive bulk actions
  Approvers required: 1 Independent Oversight Reviewer, in addition to
  any Tier 1/Tier 2 approval already obtained on the case
```

A case may pass through Tier 1 or Tier 2 and *also* require Tier 3 if it
independently triggers an elevated-risk condition — the tiers are additive
escalation paths, not mutually exclusive categories.

---

## 8. Decision Packet Definition

A decision packet is the unit of evidence-based review presented to a
human approver. Conceptual fields (pre-Prisma; formalized as `DecisionCase`
and related entities no earlier than M38):

| Field group | Contents |
|---|---|
| Case identity | `caseType`, `subjectType`/`subjectId` (references existing Employee/Vacancy/Candidate/etc. — no duplication of source data), `tenantId` |
| Evidence | Case-scoped `EvidenceItem` list, PII-minimized/masked by default |
| Policy results | `PolicyEvaluation` outcomes (PASS/FAIL/WARN) with reasoning |
| Proposed action | The specific action being requested, in plain language |
| Confidence | Where AI-prepared, the confidence and reasoning behind the preparation (reusing the existing `IntelligenceExplainabilityOutput` shape) |
| Risk | Which tier (1/2/3) the case requires, and why |
| Affected records | Explicit list of what the action would change |
| Approval controls | Approve / Reject / Needs Information (returns the case to preparation for revision or additional evidence), with required-approver-count enforcement per tier |

---

## 9. Decision Lifecycle

```text
Detected → AI Prepared → Policy Checked → Awaiting Human →
  Approved / Rejected / Needs Information → Executed → Verified → Closed
```

| State | Actor | Notes |
|---|---|---|
| Detected | System (deterministic trigger) | A case originates from existing data (e.g., an offer ready for authorization) |
| AI Prepared | AI job function (logical, in-module) | Drafts evidence summary and proposed action; never itself a decision |
| Policy Checked | Policy Guard (deterministic, M42) | Produces `PolicyEvaluation`; failures may trigger Tier 3 escalation |
| Awaiting Human | — | Case is queued for the tier(s) it requires |
| Approved / Rejected / Needs Information | Human (Tier 1, 2, or 3 as required) | `ApprovalDecision`; self-review and same-subject approval structurally disallowed; Needs Information returns the case to preparation for revision or additional evidence rather than closing it |
| Executed | System, via existing deterministic endpoints only | `ActionExecution`; never triggered by AI directly |
| Verified | System | `VerificationResult` — confirms the action had its intended effect |
| Closed | — | Terminal state; full history retained for audit |

---

## 10. AI/HIL Boundary

- The seven AI job functions are logical responsibilities inside the
  existing `IntelligenceModule` — no new agent identity, login, or service
  deployment (`GD-M35-1` Decision 6).
- Deterministic-first, permanently: scoring, policy evaluation,
  authorization, approval routing, execution, and verification remain
  deterministic NestJS services under all circumstances — this is not a
  transitional state.
- LLM use, when it is eventually authorized (M44/M45, each under its own
  governance decision), is confined to summaries, explanations, drafting,
  evidence comparison, natural-language retrieval, and decision-packet
  preparation. It is never used for scoring, policy evaluation,
  authorization, approval, execution, or verification.
- Shadow mode first: any future LLM function ships read-only/observe-only
  before any runtime output reaches a human decision surface or an
  execution path.
- Non-bypass guarantee: no AI output, in shadow mode or after runtime
  integration, may skip policy evaluation, authorization, required human
  approval, deterministic execution, or audit — ever.
- No LLM/OpenAI/external AI provider call exists anywhere in the platform
  until a dedicated future governance decision authorizes it, per
  `GD-M30-1` Decision 12 (restated unchanged through `GD-M34-1` Decision 19
  and this document's `GD-M35-1` Decision 7).

---

## 11. Deterministic Search Scope

Satisfies `spec/01_requirements.md` FR-850 (Global Search), FR-851
(Workforce Search), and FR-852 (Report Search).

```text
Search targets: Employees, Positions, Vacancies, Candidates, Forecasts,
  Reports (per FR-850)
Access: permission-filtered per FR-852's "access controlled by
  permissions" acceptance criterion; tenant-scoped, identical isolation
  discipline to every existing endpoint
AI involvement: none. Search is deterministic retrieval only.
Labeling: presented to users as "Search" — never as an "AI command bar"
  or any conversational-AI-branded interface.
Sequencing: implemented (M41) before or alongside the first Command
  Center release (M43), not after it.
Explicitly deferred: conversational AI commands and natural-language
  action initiation, which remain out of scope until their own future
  governance decision, and which — even once introduced — may never
  bypass policy evaluation, authorization, approval, execution, or audit.
```

---

## 12. Audit Prerequisite Specification

Addresses the confirmed gap: `AuditService.logEvent()` is write-only,
swallows its own failures via try/catch with no retry, and has no read
endpoint anywhere in the repository.

**Required before Independent Oversight Reviewer activation (and before
elevation is activated for production use):**

| Requirement | Description |
|---|---|
| Tenant-scoped audit-read API | New read endpoint(s), enforcing the same `tenantId`-from-JWT-only discipline as every existing endpoint |
| Permission-controlled viewer | Gated by the new capability model (M36), not a role-string check |
| Filtering and search | By actor, action, result, resource, date range, and case correlation |
| Actor/action/result/resource/timestamp visibility | Minimum fields every audit record must expose to an authorized viewer |
| Approval and execution correlation | An audit reader must be able to trace a `DecisionCase` from detection through approval, execution, and verification |
| Tamper-detection controls | A design for detecting unauthorized modification of audit history (e.g., append-only enforcement at the database layer, hash-chaining, or equivalent — specific mechanism is an M39 implementation decision) |
| Retention enforcement | Consistent with any existing data-retention requirements (e.g., `directives/07_compliance_rules.md`'s retention language, where applicable) |
| Observability and recovery for failed audit writes | Replaces today's silent `Logger.error`-and-continue behavior with active alerting and a defined recovery/replay path — an audit write failure must become visible to operators, not merely logged to a file no one watches |

This is a backend-and-viewer specification, not merely a UI task — the
current `AuditService` itself needs a design change (failure handling,
tamper-detection posture) in addition to a new read path and viewer.

---

## 13. Hire-Endpoint RBAC Inconsistency Resolution Design

**Confirmed conflict:**
- Implemented: `hire.controller.ts:57` — `@RequireRoles('System
  Administrator', 'HR Director')` (per `GD-M19-1`).
- Directive: `directives/10` RBAC-701 — "Hiring approval requires: Hiring
  Manager, HR Director."

**Resolution design (for M40, not implemented by M35):**

```text
Replace the current single-gate SA/HRD-only hire endpoint's RBAC with the
Tier 2 maker-checker model (Section 7):
  - one department/hiring authority approval (satisfies the directive's
    "Hiring Manager" intent, expressed as a capability rather than a role
    name)
  - one HR authority approval (satisfies both the directive's "HR
    Director" language and the implemented endpoint's HR Director grant)

System Administrator's standing hire-approval capability is replaced by
elevation: an SA-elevated Workforce Decision Owner may act in the HR
authority capacity for a hire case only during an active, audited
elevation session (Section 4) — never as a standing, unconditional grant.

This resolution must be implemented via its own governance decision
(targeted M40) that explicitly supersedes GD-M19-1's RBAC list — GD-M19-1
itself is not edited, consistent with this project's practice of
superseding rather than rewriting historical decisions (the same pattern
GD-M33-1 used against GD-M32-1 Decision 11).

The existing hire endpoint's transaction atomicity, idempotency
(APPLICATION_ALREADY_HIRED guard), vacancy-fill guard, and audit event
emission (GD-M19-1 Decisions on employee creation, vacancy fill, position
assignment) are all preserved unchanged — only the RBAC gate and its
approval-count semantics change.
```

---

## 14. Post-M35 Roadmap

See `GD-M35-1.md` Decision 15 for the authoritative, governance-bound
version of this roadmap (M36 through M46). Summarized here for
convenience:

```text
M36 — Capability-Based Authorization Foundation
M37 — Elevation Sessions (build, not production activation)
M38 — Decision Case and Approval Foundation
M39 — Audit Prerequisite (Read API + Viewer)
M40 — Hire-Endpoint Maker-Checker Resolution
M41 — Deterministic Global Search
M42 — Deterministic Policy Guard Logical Function
M43 — Deterministic Command Center MVP
M44 — LLM Shadow Mode (Read-Only)
M45 — Governed Runtime LLM Integration (Narrow)
M46 — Two-Profile Cutover
```

Each milestone requires its own governance decision before implementation
begins. None of M36 through M46 is authorized by M35 itself.

---

## 15. Explicit M35 Non-Scope

Not implemented, built, seeded, migrated, or executed as part of M35:

```text
PermissionsGuard
Permission or RolePermission seed data
ElevationSession
DecisionCase, EvidenceItem, PolicyEvaluation, ApprovalRequest,
  ApprovalDecision, AgentRun, ActionExecution, VerificationResult
Audit read endpoint or viewer UI
Search endpoint or UI
Workforce Command Center UI of any kind
LLM/OpenAI/external AI provider integration of any kind, including
  shadow mode
AI agents or AI service identities
Role migration of any real user
Test file changes of any kind
Prisma schema changes or migrations
Dependency installation, service starts, builds, or test execution
```

---

## 16. Preserved Capabilities (Migration Foundation)

The following existing, working capabilities are the foundation this
redesign builds on and must not be treated as disposable merely because
authorization and UI will change around them:

- Workforce records and lifecycle behavior (positions, vacancies,
  employees, skills, certifications)
- Recruiting and hiring workflows (candidates through hire-to-employee
  conversion)
- The five deterministic Intelligence services (Vacancy Risk, Workforce
  Readiness, Attrition Risk, Department Gap, Executive Metrics)
- The Executive Dashboard and Operational Snapshot analytics
- Tenant isolation, enforced without exception across every endpoint
- Existing PII restrictions (RBAC-952 and the aggregate-only guarantees in
  `GD-M31-1` through `GD-M33-1`)
- Audit-writing patterns (extended, not replaced, by the audit prerequisite)
- Role-aware navigation (`platform-header.tsx`'s pattern, extended to
  capability-based gating)
- Existing test coverage (the 22+12 role-dependent spec/e2e files become
  the capability-parity regression baseline, not deleted)

---

## 17. Implementation Authorization Gate

No milestone in Section 14's roadmap may begin implementation until:

1. The M35 blueprint document and `GD-M35-1.md` are completed governance
   artifacts — their completion covers documentation and governance only.
   Implementation remains prohibited under M35 itself; M36 may begin only
   under its own separate, explicit implementation authorization.
2. The capability matrix (Section 6) and its parity-proof method are
   confirmed acceptable.
3. The tiered approval model (Section 7) and its action-to-tier mapping
   are confirmed complete and correct.
4. The audit prerequisite scope (Section 12) is confirmed sufficient to
   gate Independent Oversight Reviewer activation.
5. The roadmap sequencing — authorization → elevation (build only) →
   decision cases → audit prerequisite → hire resolution → Search →
   deterministic Command Center MVP → LLM shadow mode → governed runtime
   LLM → cutover — is confirmed acceptable, with explicit acknowledgment
   that M44/M45 (LLM work) each require their own separate future
   approval and are not pre-authorized by this blueprint.

Upon that approval, the next action is a separate, dedicated governance
decision authorizing M36 (Capability-Based Authorization Foundation) —
the first milestone permitted to touch any source file.
