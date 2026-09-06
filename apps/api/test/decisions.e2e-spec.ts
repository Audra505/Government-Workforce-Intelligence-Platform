// Reference: governance/GD-M38-1.md — M38 Decision Case and Approval
// Foundation (Decisions 4, 6-9, 11-14, 16-17 exercised directly by this
// suite).
//
// Real-database integration tests — no HTTP, no supertest, no NestJS
// application bootstrap. M38 has no controller (GD-M38-1 Decision 18), so
// this exercises PrismaService + AuditService + DecisionCaseService +
// ApprovalService directly against the repository's local development
// PostgreSQL instance, following elevation-session.e2e-spec.ts's exact
// convention (real PrismaClient, self-contained fixtures created in
// beforeAll and deleted in afterAll).
//
// This file exists specifically because the *.service.spec.ts mocked
// $transaction suites cannot prove: (a) the migration's CHECK constraints
// and partial/unique indexes actually reject invalid or conflicting writes
// at the database layer, (b) a forced audit-write failure actually rolls
// back the real DecisionCase/ApprovalRequest/ApprovalDecision rows
// together, (c) concurrent conflicting writes are rejected deterministically
// under a real race, and (d) cross-tenant references are truly rejected
// against real rows in another tenant.
//
// NOTE: this suite requires the M38 migration
// (20260802000000_m38_decision_case_and_approval_foundation) to have been
// applied to the target database. It is created, but NOT executed, as part
// of this implementation pass (see the task's validation boundary) — running
// it is deferred to the next, separate validation pass.

import 'reflect-metadata';
import { PrismaClient, DecisionCaseStatus, ApprovalRequestStatus, DecisionCaseSubjectType } from '@prisma/client';

import type { PrismaService } from '../src/database/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { AuditEventType } from '../src/audit/enums/audit-event-type.enum';
import { DecisionCaseService } from '../src/decisions/decision-case.service';
import { ApprovalService } from '../src/decisions/approval.service';

const FIXTURE_PASSWORD_HASH = '$2b$12$e2eFixtureHashNotARealBcryptHash1234567';
const SUFFIX = Date.now();
const FIXTURE_TENANT_CODE = `E2E-DECISIONS-${SUFFIX}`;
const CROSS_TENANT_CODE = `E2E-DECISIONS-CROSS-${SUFFIX}`;

describe('DecisionCaseService + ApprovalService (real database)', () => {
  let prisma: PrismaClient;
  let auditService: AuditService;
  let decisionCaseService: DecisionCaseService;
  let approvalService: ApprovalService;

  let tenantId: string;
  let crossTenantId: string;
  let initiatorId: string;
  let preparerId: string;
  let actionAuthorityApproverId: string; // holds a role qualifying for OFFERS_APPROVE-style ACTION_AUTHORITY
  let hiringManagerId: string;
  let hrDirectorId: string;
  let complianceOfficerId: string;
  let crossTenantUserId: string;
  let usersCreatePermissionId: string;
  let candidateId: string;
  let vacancyId: string;
  let applicationId: string;
  let offerId: string;
  let crossTenantOfferId: string;

  const createdCaseIds: string[] = [];
  const extraUserIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();
    auditService = new AuditService(prisma as unknown as PrismaService);
    decisionCaseService = new DecisionCaseService(prisma as unknown as PrismaService, auditService);
    approvalService = new ApprovalService(prisma as unknown as PrismaService, auditService);

    const tenant = await prisma.tenant.create({
      data: { name: 'E2E Decisions Tenant', code: FIXTURE_TENANT_CODE, status: 'ACTIVE' },
    });
    tenantId = tenant.id;

    const crossTenant = await prisma.tenant.create({
      data: { name: 'E2E Decisions Cross Tenant', code: CROSS_TENANT_CODE, status: 'ACTIVE' },
    });
    crossTenantId = crossTenant.id;

    async function makeUser(emailPrefix: string, tenant: string): Promise<string> {
      const user = await prisma.user.create({
        data: {
          tenantId: tenant,
          email: `${emailPrefix}-${SUFFIX}@test.gov`,
          passwordHash: FIXTURE_PASSWORD_HASH,
          firstName: 'E2E',
          lastName: emailPrefix,
          status: 'ACTIVE',
          failedLoginAttempts: 0,
        },
      });
      return user.id;
    }

    initiatorId = await makeUser('decisions-initiator', tenantId);
    preparerId = await makeUser('decisions-preparer', tenantId);
    actionAuthorityApproverId = await makeUser('decisions-action-authority', tenantId);
    hiringManagerId = await makeUser('decisions-hiring-manager', tenantId);
    hrDirectorId = await makeUser('decisions-hr-director', tenantId);
    complianceOfficerId = await makeUser('decisions-compliance-officer', tenantId);
    crossTenantUserId = await makeUser('decisions-cross', crossTenantId);

    // GD-M38-1 Decision 13 — dormant role-based qualification. These roles
    // are expected to already exist from the M36 seed
    // (apps/api/prisma/seed.ts / permissions.catalog.ts's ALL_PLATFORM_ROLES).
    const hiringManagerRole = await prisma.role.findFirstOrThrow({ where: { name: 'Hiring Manager' } });
    const hrDirectorRole = await prisma.role.findFirstOrThrow({ where: { name: 'HR Director' } });
    const complianceOfficerRole = await prisma.role.findFirstOrThrow({ where: { name: 'Compliance Officer' } });

    await prisma.userRole.create({ data: { userId: hiringManagerId, roleId: hiringManagerRole.id } });
    await prisma.userRole.create({ data: { userId: hrDirectorId, roleId: hrDirectorRole.id } });
    await prisma.userRole.create({ data: { userId: complianceOfficerId, roleId: complianceOfficerRole.id } });

    // ACTION_AUTHORITY resolves via the live M36 capability->role mapping —
    // grant a role that CAPABILITY_ROLE_MAPPINGS maps to users:create
    // (ROLES_SA_HRD -> System Administrator or HR Director). Reuse HR
    // Director rather than inventing a new mapping.
    await prisma.userRole.create({ data: { userId: actionAuthorityApproverId, roleId: hrDirectorRole.id } });

    const usersCreatePermission = await prisma.permission.findFirstOrThrow({
      where: { resource: 'users', action: 'create' },
    });
    usersCreatePermissionId = usersCreatePermission.id;

    // Minimal recruiting-domain fixture chain for an OFFER-subject case.
    const candidate = await prisma.candidate.create({
      data: {
        tenantId,
        firstName: 'E2E',
        lastName: 'Candidate',
        email: `decisions-candidate-${SUFFIX}@test.gov`,
        status: 'ACTIVE',
      },
    });
    candidateId = candidate.id;

    const department = await prisma.department.create({
      data: { tenantId, name: 'E2E Decisions Department', code: `E2E-DEC-DEPT-${SUFFIX}`, status: 'ACTIVE' },
    });

    const position = await prisma.position.create({
      data: {
        tenantId,
        departmentId: department.id,
        title: 'E2E Decisions Position',
        status: 'ACTIVE',
      },
    });

    const vacancy = await prisma.vacancy.create({
      data: { tenantId, positionId: position.id, status: 'OPEN' },
    });
    vacancyId = vacancy.id;

    const application = await prisma.application.create({
      data: { tenantId, candidateId, vacancyId, status: 'OFFER' },
    });
    applicationId = application.id;

    const offer = await prisma.offer.create({
      data: { tenantId, applicationId, status: 'DRAFT' },
    });
    offerId = offer.id;

    const crossCandidate = await prisma.candidate.create({
      data: {
        tenantId: crossTenantId,
        firstName: 'Cross',
        lastName: 'Candidate',
        email: `decisions-cross-candidate-${SUFFIX}@test.gov`,
        status: 'ACTIVE',
      },
    });
    const crossDepartment = await prisma.department.create({
      data: { tenantId: crossTenantId, name: 'Cross Dept', code: `E2E-CROSS-DEPT-${SUFFIX}`, status: 'ACTIVE' },
    });
    const crossPosition = await prisma.position.create({
      data: { tenantId: crossTenantId, departmentId: crossDepartment.id, title: 'Cross Position', status: 'ACTIVE' },
    });
    const crossVacancy = await prisma.vacancy.create({
      data: { tenantId: crossTenantId, positionId: crossPosition.id, status: 'OPEN' },
    });
    const crossApplication = await prisma.application.create({
      data: { tenantId: crossTenantId, candidateId: crossCandidate.id, vacancyId: crossVacancy.id, status: 'OFFER' },
    });
    const crossOffer = await prisma.offer.create({ data: { tenantId: crossTenantId, applicationId: crossApplication.id, status: 'DRAFT' } });
    crossTenantOfferId = crossOffer.id;
  });

  afterAll(async () => {
    if (prisma) {
      // Children first: decisions -> risk triggers / evidence / requests ->
      // requirements/decisions/evidence-links, then cases themselves.
      const allCases = await prisma.decisionCase.findMany({
        where: { tenantId: { in: [tenantId, crossTenantId] } },
        select: { id: true },
      });
      const caseIds = allCases.map((c) => c.id);
      if (caseIds.length > 0) {
        const requests = await prisma.approvalRequest.findMany({
          where: { decisionCaseId: { in: caseIds } },
          select: { id: true },
        });
        const requestIds = requests.map((r) => r.id);
        if (requestIds.length > 0) {
          await prisma.approvalDecision.deleteMany({ where: { approvalRequestId: { in: requestIds } } }).catch(() => {});
          await prisma.approvalRequestEvidence.deleteMany({ where: { approvalRequestId: { in: requestIds } } }).catch(() => {});
          await prisma.approvalRequirement.deleteMany({ where: { approvalRequestId: { in: requestIds } } }).catch(() => {});
          await prisma.approvalRequest.deleteMany({ where: { id: { in: requestIds } } }).catch(() => {});
        }
        await prisma.evidenceItem.deleteMany({ where: { decisionCaseId: { in: caseIds } } }).catch(() => {});
        await prisma.decisionCaseRiskTrigger.deleteMany({ where: { decisionCaseId: { in: caseIds } } }).catch(() => {});
        await prisma.decisionCase.deleteMany({ where: { id: { in: caseIds } } }).catch(() => {});
      }

      await prisma.offer.deleteMany({ where: { tenantId: { in: [tenantId, crossTenantId] } } }).catch(() => {});
      await prisma.application.deleteMany({ where: { tenantId: { in: [tenantId, crossTenantId] } } }).catch(() => {});
      await prisma.vacancy.deleteMany({ where: { tenantId: { in: [tenantId, crossTenantId] } } }).catch(() => {});
      await prisma.position.deleteMany({ where: { tenantId: { in: [tenantId, crossTenantId] } } }).catch(() => {});
      await prisma.candidate.deleteMany({ where: { tenantId: { in: [tenantId, crossTenantId] } } }).catch(() => {});
      await prisma.department.deleteMany({ where: { tenantId: { in: [tenantId, crossTenantId] } } }).catch(() => {});

      const actorIds = [
        initiatorId,
        preparerId,
        actionAuthorityApproverId,
        hiringManagerId,
        hrDirectorId,
        complianceOfficerId,
        crossTenantUserId,
        ...extraUserIds,
      ].filter(Boolean);

      await prisma.userRole.deleteMany({ where: { userId: { in: actorIds } } }).catch(() => {});
      if (actorIds.length > 0) {
        await prisma.auditEvent.deleteMany({ where: { userId: { in: actorIds } } }).catch(() => {});
      }
      for (const id of actorIds) {
        await prisma.user.delete({ where: { id } }).catch(() => {});
      }
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => {});
      await prisma.tenant.delete({ where: { id: crossTenantId } }).catch(() => {});

      await prisma.$disconnect();
    }
  });

  // --------------------------------------------------------------------------
  // DecisionCase lifecycle + strict audit transactionality
  // --------------------------------------------------------------------------

  describe('DecisionCase lifecycle', () => {
    it('SUCCESS: creates an OPEN case with version 1, and the DECISION_CASE_CREATED audit event is committed together', async () => {
      const created = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: null,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: basic case creation',
      });
      expect(created.outcome).toBe('SUCCESS');
      const caseId = (created as { outcome: 'SUCCESS'; decisionCase: { id: string } }).decisionCase.id;
      createdCaseIds.push(caseId);

      const row = await prisma.decisionCase.findUnique({ where: { id: caseId } });
      expect(row!.status).toBe(DecisionCaseStatus.OPEN);
      expect(row!.version).toBe(1);

      const auditRow = await prisma.auditEvent.findFirst({
        where: { entityId: caseId, action: AuditEventType.DECISION_CASE_CREATED },
      });
      expect(auditRow).not.toBeNull();
    });

    it('FORCED AUDIT FAILURE: rolls back case creation — no DecisionCase row is left behind', async () => {
      const spy = jest.spyOn(auditService, 'logEventStrict').mockRejectedValueOnce(new Error('forced audit failure'));
      const idempotencyKey = `e2e-decisions-rollback-${SUFFIX}`;
      const result = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: null,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: prove rollback',
        idempotencyKey,
      });
      expect(result.outcome).toBe('INTERNAL_ERROR');
      const row = await prisma.decisionCase.findFirst({ where: { tenantId, idempotencyKey } });
      expect(row).toBeNull();
      spy.mockRestore();
    });

    it('CROSS-TENANT SUBJECT REJECTED: an OFFER subject belonging to another tenant is rejected', async () => {
      const result = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.OFFER,
        subjectId: crossTenantOfferId,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: cross-tenant subject rejected',
      });
      expect(result.outcome).toBe('SUBJECT_NOT_FOUND');
    });

    it('SUCCESS: an OFFER subject belonging to this tenant is accepted', async () => {
      const created = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.OFFER,
        subjectId: offerId,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: OFFER subject case',
      });
      expect(created.outcome).toBe('SUCCESS');
      createdCaseIds.push((created as { outcome: 'SUCCESS'; decisionCase: { id: string } }).decisionCase.id);
    });

    it('CHECK CONSTRAINT: a direct write with subjectType=GENERAL and a non-null subjectId is rejected by the database', async () => {
      await expect(
        prisma.decisionCase.create({
          data: {
            tenantId,
            subjectType: DecisionCaseSubjectType.GENERAL,
            subjectId: offerId,
            initiatedByUserId: initiatorId,
            preparedByUserId: preparerId,
            purpose: 'Direct write bypassing service-layer subject validation',
          },
        }),
      ).rejects.toBeTruthy(); // chk_decision_cases_subject_id_matches_type
    });

    it('CONCURRENCY: two concurrent case creations with the same tenant-scoped idempotencyKey — exactly one SUCCEEDS', async () => {
      const idempotencyKey = `e2e-decisions-concurrent-idem-${SUFFIX}`;
      const [a, b] = await Promise.all([
        decisionCaseService.createDecisionCase({
          tenantId,
          subjectType: DecisionCaseSubjectType.GENERAL,
          subjectId: null,
          initiatedByUserId: initiatorId,
          preparedByUserId: preparerId,
          purpose: 'E2E: concurrent A',
          idempotencyKey,
        }),
        decisionCaseService.createDecisionCase({
          tenantId,
          subjectType: DecisionCaseSubjectType.GENERAL,
          subjectId: null,
          initiatedByUserId: initiatorId,
          preparedByUserId: preparerId,
          purpose: 'E2E: concurrent B',
          idempotencyKey,
        }),
      ]);
      const outcomes = [a.outcome, b.outcome].sort();
      expect(outcomes).toEqual(['DUPLICATE_IDEMPOTENCY_KEY', 'SUCCESS']);
      const succeeded = [a, b].find((r) => r.outcome === 'SUCCESS') as { outcome: 'SUCCESS'; decisionCase: { id: string } };
      createdCaseIds.push(succeeded.decisionCase.id);

      const rows = await prisma.decisionCase.findMany({ where: { tenantId, idempotencyKey } });
      expect(rows).toHaveLength(1);
    });

    it('CANCELLATION: initiator can cancel an OPEN case; a second cancel attempt fails as terminal-state-immutable', async () => {
      const created = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: null,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: cancellation',
      });
      const caseId = (created as { outcome: 'SUCCESS'; decisionCase: { id: string } }).decisionCase.id;
      createdCaseIds.push(caseId);

      const cancelled = await decisionCaseService.cancelDecisionCase({
        tenantId,
        decisionCaseId: caseId,
        expectedVersion: 1,
        cancelledByUserId: initiatorId,
      });
      expect(cancelled.outcome).toBe('SUCCESS');

      const again = await decisionCaseService.cancelDecisionCase({
        tenantId,
        decisionCaseId: caseId,
        expectedVersion: 2,
        cancelledByUserId: initiatorId,
      });
      expect(again.outcome).toBe('INVALID_LIFECYCLE_STATE');
    });
  });

  // --------------------------------------------------------------------------
  // Full Tier 1 lifecycle: OPEN -> AWAITING_APPROVAL -> APPROVED
  // --------------------------------------------------------------------------

  describe('Tier 1 approval lifecycle against the real database', () => {
    it('SUCCESS: single ACTION_AUTHORITY requirement, GRANTED by a qualifying, non-preparer approver, resolves the request and the case', async () => {
      const created = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: null,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: Tier 1 full lifecycle',
      });
      const caseId = (created as { outcome: 'SUCCESS'; decisionCase: { id: string } }).decisionCase.id;
      createdCaseIds.push(caseId);

      const submitted = await approvalService.submitApprovalRequest({
        tenantId,
        decisionCaseId: caseId,
        expectedCaseVersion: 1,
        submittedByUserId: preparerId,
        basePlanType: 'TIER_1',
        actionAuthorityCapabilityId: usersCreatePermissionId,
      });
      expect(submitted.outcome).toBe('SUCCESS');
      const request = (submitted as { outcome: 'SUCCESS'; request: { id: string; requirements: Array<{ id: string }> } }).request;

      const caseAfterSubmit = await prisma.decisionCase.findUnique({ where: { id: caseId } });
      expect(caseAfterSubmit!.status).toBe(DecisionCaseStatus.AWAITING_APPROVAL);

      const decided = await approvalService.recordApprovalDecision({
        tenantId,
        approvalRequestId: request.id,
        approvalRequirementId: request.requirements[0]!.id,
        decidedByUserId: actionAuthorityApproverId,
        decision: 'GRANTED',
        reason: 'E2E: qualifying approver grants',
      });
      expect(decided.outcome).toBe('SUCCESS_REQUEST_APPROVED');

      const finalCase = await prisma.decisionCase.findUnique({ where: { id: caseId } });
      expect(finalCase!.status).toBe(DecisionCaseStatus.APPROVED);
      const finalRequest = await prisma.approvalRequest.findUnique({ where: { id: request.id } });
      expect(finalRequest!.status).toBe(ApprovalRequestStatus.APPROVED);

      const auditActions = await prisma.auditEvent.findMany({
        where: { entityId: { in: [caseId, request.id] } },
        select: { action: true },
      });
      const actionSet = new Set(auditActions.map((a) => a.action));
      expect(actionSet.has(AuditEventType.APPROVAL_REQUEST_SUBMITTED)).toBe(true);
      expect(actionSet.has(AuditEventType.APPROVAL_DECISION_GRANTED)).toBe(true);
      expect(actionSet.has(AuditEventType.DECISION_CASE_APPROVED)).toBe(true);
    });

    it('PREPARER_SEPARATION_VIOLATION: the substantive preparer cannot decide the Tier 1 requirement, even holding a qualifying role', async () => {
      const created = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: null,
        initiatedByUserId: initiatorId,
        preparedByUserId: actionAuthorityApproverId, // preparer IS the qualifying role holder here
        purpose: 'E2E: Tier 1 preparer separation',
      });
      const caseId = (created as { outcome: 'SUCCESS'; decisionCase: { id: string } }).decisionCase.id;
      createdCaseIds.push(caseId);

      const submitted = await approvalService.submitApprovalRequest({
        tenantId,
        decisionCaseId: caseId,
        expectedCaseVersion: 1,
        submittedByUserId: actionAuthorityApproverId,
        basePlanType: 'TIER_1',
        actionAuthorityCapabilityId: usersCreatePermissionId,
      });
      const request = (submitted as { outcome: 'SUCCESS'; request: { id: string; requirements: Array<{ id: string }> } }).request;

      const decided = await approvalService.recordApprovalDecision({
        tenantId,
        approvalRequestId: request.id,
        approvalRequirementId: request.requirements[0]!.id,
        decidedByUserId: actionAuthorityApproverId, // same person as preparer
        decision: 'GRANTED',
        reason: 'Should be rejected',
      });
      expect(decided.outcome).toBe('PREPARER_SEPARATION_VIOLATION');
    });
  });

  // --------------------------------------------------------------------------
  // Full Tier 2 lifecycle: two distinct requirements, two distinct humans
  // --------------------------------------------------------------------------

  describe('Tier 2 approval lifecycle against the real database', () => {
    it('SUCCESS: DEPARTMENT_OR_HIRING_AUTHORITY and HR_AUTHORITY each decided by a distinct qualifying human resolves the request', async () => {
      const created = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: null,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: Tier 2 full lifecycle',
      });
      const caseId = (created as { outcome: 'SUCCESS'; decisionCase: { id: string } }).decisionCase.id;
      createdCaseIds.push(caseId);

      const submitted = await approvalService.submitApprovalRequest({
        tenantId,
        decisionCaseId: caseId,
        expectedCaseVersion: 1,
        submittedByUserId: preparerId,
        basePlanType: 'TIER_2',
      });
      const request = (submitted as {
        outcome: 'SUCCESS';
        request: { id: string; requirements: Array<{ id: string; requiredAuthorityCategory: string }> };
      }).request;
      expect(request.requirements).toHaveLength(2);

      const hiringRequirement = request.requirements.find((r) => r.requiredAuthorityCategory === 'DEPARTMENT_OR_HIRING_AUTHORITY')!;
      const hrRequirement = request.requirements.find((r) => r.requiredAuthorityCategory === 'HR_AUTHORITY')!;

      const first = await approvalService.recordApprovalDecision({
        tenantId,
        approvalRequestId: request.id,
        approvalRequirementId: hiringRequirement.id,
        decidedByUserId: hiringManagerId,
        decision: 'GRANTED',
        reason: 'E2E: hiring manager grants',
      });
      expect(first.outcome).toBe('SUCCESS_PENDING');

      const second = await approvalService.recordApprovalDecision({
        tenantId,
        approvalRequestId: request.id,
        approvalRequirementId: hrRequirement.id,
        decidedByUserId: hrDirectorId,
        decision: 'GRANTED',
        reason: 'E2E: HR director grants',
      });
      expect(second.outcome).toBe('SUCCESS_REQUEST_APPROVED');
    });

    it('one person cannot satisfy both Tier 2 requirements on the same request (DB-backed uniqueness)', async () => {
      const created = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: null,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: Tier 2 one-person-two-requirements rejected',
      });
      const caseId = (created as { outcome: 'SUCCESS'; decisionCase: { id: string } }).decisionCase.id;
      createdCaseIds.push(caseId);

      const submitted = await approvalService.submitApprovalRequest({
        tenantId,
        decisionCaseId: caseId,
        expectedCaseVersion: 1,
        submittedByUserId: preparerId,
        basePlanType: 'TIER_2',
      });
      const request = (submitted as {
        outcome: 'SUCCESS';
        request: { id: string; requirements: Array<{ id: string; requiredAuthorityCategory: string }> };
      }).request;
      const hiringRequirement = request.requirements.find((r) => r.requiredAuthorityCategory === 'DEPARTMENT_OR_HIRING_AUTHORITY')!;
      const hrRequirement = request.requirements.find((r) => r.requiredAuthorityCategory === 'HR_AUTHORITY')!;

      // hrDirectorId only qualifies for HR_AUTHORITY, not DEPARTMENT_OR_HIRING_AUTHORITY,
      // but even a qualifying dual-holder must still be stopped by the
      // (approvalRequestId, decidedByUserId) uniqueness constraint below —
      // simulate by attempting to decide the SAME requirement's counterpart
      // requirement with the same decider who already decided one:
      const first = await approvalService.recordApprovalDecision({
        tenantId,
        approvalRequestId: request.id,
        approvalRequirementId: hrRequirement.id,
        decidedByUserId: hrDirectorId,
        decision: 'GRANTED',
        reason: 'First decision',
      });
      expect(first.outcome).toBe('SUCCESS_PENDING');

      // Grant hrDirectorId the Hiring Manager role too, to isolate this test
      // to the uniqueness constraint rather than category qualification.
      const hiringManagerRole = await prisma.role.findFirstOrThrow({ where: { name: 'Hiring Manager' } });
      await prisma.userRole.create({ data: { userId: hrDirectorId, roleId: hiringManagerRole.id } });
      try {
        const second = await approvalService.recordApprovalDecision({
          tenantId,
          approvalRequestId: request.id,
          approvalRequirementId: hiringRequirement.id,
          decidedByUserId: hrDirectorId, // same person as the first decision
          decision: 'GRANTED',
          reason: 'Should be rejected by uniqueness',
        });
        expect(second.outcome).toBe('DUPLICATE_DECIDER_ON_REQUEST');
      } finally {
        await prisma.userRole.delete({ where: { userId_roleId: { userId: hrDirectorId, roleId: hiringManagerRole.id } } }).catch(() => {});
      }
    });
  });

  // --------------------------------------------------------------------------
  // Tier 3 escalation via explicit risk trigger + bidirectional independence
  // --------------------------------------------------------------------------

  describe('Tier 3 escalation against the real database', () => {
    it('SUCCESS: an explicit risk trigger adds an Independent Oversight Reviewer requirement to the same version, decided by a distinct, qualifying reviewer', async () => {
      const created = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: null,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: Tier 3 escalation',
      });
      const caseId = (created as { outcome: 'SUCCESS'; decisionCase: { id: string } }).decisionCase.id;
      createdCaseIds.push(caseId);

      const trigger = await decisionCaseService.recordRiskTrigger({
        tenantId,
        decisionCaseId: caseId,
        triggerType: 'SENSITIVE_BULK_ACTION',
        reason: 'E2E: explicit deterministic trigger',
        sourceOrProvenance: 'DETERMINISTIC_SYSTEM',
      });
      expect(trigger.outcome).toBe('SUCCESS');

      const submitted = await approvalService.submitApprovalRequest({
        tenantId,
        decisionCaseId: caseId,
        expectedCaseVersion: 1,
        submittedByUserId: preparerId,
        basePlanType: 'TIER_1',
        actionAuthorityCapabilityId: usersCreatePermissionId,
      });
      const request = (submitted as {
        outcome: 'SUCCESS';
        request: { id: string; requirements: Array<{ id: string; tier: string; requiredAuthorityCategory: string }> };
      }).request;
      expect(request.requirements).toHaveLength(2);
      const tier3Requirement = request.requirements.find((r) => r.tier === 'TIER_3')!;
      const tier1Requirement = request.requirements.find((r) => r.tier === 'TIER_1')!;

      const tier3Decision = await approvalService.recordApprovalDecision({
        tenantId,
        approvalRequestId: request.id,
        approvalRequirementId: tier3Requirement.id,
        decidedByUserId: complianceOfficerId,
        decision: 'GRANTED',
        reason: 'E2E: independent reviewer grants',
      });
      expect(tier3Decision.outcome).toBe('SUCCESS_PENDING');

      // Bidirectional independence: the Tier 3 reviewer cannot also decide the base-tier
      // requirement — even when otherwise qualified for it. Temporarily grant
      // complianceOfficerId the HR Director role (which DOES map to users:create,
      // the ACTION_AUTHORITY capability here) so this attempt is blocked by the
      // tier-independence rule specifically, not merely by a qualification failure
      // that would mask whether the independence check itself works.
      const hrDirectorRoleForIndependenceCheck = await prisma.role.findFirstOrThrow({ where: { name: 'HR Director' } });
      await prisma.userRole.create({ data: { userId: complianceOfficerId, roleId: hrDirectorRoleForIndependenceCheck.id } });
      let conflicting: Awaited<ReturnType<typeof approvalService.recordApprovalDecision>>;
      try {
        conflicting = await approvalService.recordApprovalDecision({
          tenantId,
          approvalRequestId: request.id,
          approvalRequirementId: tier1Requirement.id,
          decidedByUserId: complianceOfficerId,
          decision: 'GRANTED',
          reason: 'Should be rejected — same person as Tier 3 reviewer',
        });
      } finally {
        await prisma.userRole
          .delete({ where: { userId_roleId: { userId: complianceOfficerId, roleId: hrDirectorRoleForIndependenceCheck.id } } })
          .catch(() => {});
      }
      expect(conflicting.outcome).toBe('TIER_INDEPENDENCE_VIOLATION');

      const finalGrant = await approvalService.recordApprovalDecision({
        tenantId,
        approvalRequestId: request.id,
        approvalRequirementId: tier1Requirement.id,
        decidedByUserId: actionAuthorityApproverId,
        decision: 'GRANTED',
        reason: 'E2E: qualifying, independent approver grants',
      });
      expect(finalGrant.outcome).toBe('SUCCESS_REQUEST_APPROVED');
    });
  });

  // --------------------------------------------------------------------------
  // NEEDS_INFORMATION -> resubmission -> supersession
  // --------------------------------------------------------------------------

  describe('NEEDS_INFORMATION and resubmission against the real database', () => {
    it('a NEEDS_INFORMATION decision moves the case to NEEDS_INFORMATION, and resubmission supersedes the prior request with a new version', async () => {
      const created = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: null,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: needs information + resubmission',
      });
      const caseId = (created as { outcome: 'SUCCESS'; decisionCase: { id: string } }).decisionCase.id;
      createdCaseIds.push(caseId);

      const submitted = await approvalService.submitApprovalRequest({
        tenantId,
        decisionCaseId: caseId,
        expectedCaseVersion: 1,
        submittedByUserId: preparerId,
        basePlanType: 'TIER_1',
        actionAuthorityCapabilityId: usersCreatePermissionId,
      });
      const firstRequest = (submitted as { outcome: 'SUCCESS'; request: { id: string; requirements: Array<{ id: string }> } }).request;

      const needsInfo = await approvalService.recordApprovalDecision({
        tenantId,
        approvalRequestId: firstRequest.id,
        approvalRequirementId: firstRequest.requirements[0]!.id,
        decidedByUserId: actionAuthorityApproverId,
        decision: 'NEEDS_INFORMATION',
        reason: 'E2E: need more context',
      });
      expect(needsInfo.outcome).toBe('SUCCESS_REQUEST_NEEDS_INFORMATION');

      const caseAfter = await prisma.decisionCase.findUnique({ where: { id: caseId } });
      expect(caseAfter!.status).toBe(DecisionCaseStatus.NEEDS_INFORMATION);

      const resubmitted = await approvalService.submitApprovalRequest({
        tenantId,
        decisionCaseId: caseId,
        expectedCaseVersion: caseAfter!.version,
        submittedByUserId: preparerId,
        basePlanType: 'TIER_1',
        actionAuthorityCapabilityId: usersCreatePermissionId,
      });
      expect(resubmitted.outcome).toBe('SUCCESS');
      const secondRequest = (resubmitted as { outcome: 'SUCCESS'; request: { id: string; version: number; supersedesRequestId: string | null } }).request;
      expect(secondRequest.version).toBe(2);
      expect(secondRequest.supersedesRequestId).toBe(firstRequest.id);

      const priorRequestRow = await prisma.approvalRequest.findUnique({ where: { id: firstRequest.id } });
      expect(priorRequestRow!.status).toBe(ApprovalRequestStatus.SUPERSEDED);

      const auditRow = await prisma.auditEvent.findFirst({
        where: { entityId: caseId, action: AuditEventType.DECISION_CASE_RESUBMITTED },
      });
      expect(auditRow).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Idempotency/concurrency and structural constraints unique to the real DB
  // --------------------------------------------------------------------------

  describe('idempotency, concurrency, and constraint enforcement', () => {
    it('CONCURRENCY: two concurrent PENDING-request submissions for the same case — exactly one SUCCEEDS (partial unique index)', async () => {
      const created = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: null,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: concurrent submission race',
      });
      const caseId = (created as { outcome: 'SUCCESS'; decisionCase: { id: string } }).decisionCase.id;
      createdCaseIds.push(caseId);

      const [a, b] = await Promise.all([
        approvalService.submitApprovalRequest({
          tenantId,
          decisionCaseId: caseId,
          expectedCaseVersion: 1,
          submittedByUserId: preparerId,
          basePlanType: 'TIER_1',
          actionAuthorityCapabilityId: usersCreatePermissionId,
        }),
        approvalService.submitApprovalRequest({
          tenantId,
          decisionCaseId: caseId,
          expectedCaseVersion: 1,
          submittedByUserId: preparerId,
          basePlanType: 'TIER_1',
          actionAuthorityCapabilityId: usersCreatePermissionId,
        }),
      ]);
      const outcomes = [a.outcome, b.outcome].filter((o) => o === 'SUCCESS');
      expect(outcomes.length).toBe(1); // exactly one submission wins the race

      const pendingRows = await prisma.approvalRequest.findMany({
        where: { decisionCaseId: caseId, status: ApprovalRequestStatus.PENDING },
      });
      expect(pendingRows).toHaveLength(1);
    });

    it('CONCURRENCY: two concurrent decisions on the same requirement — exactly one SUCCEEDS (unique per requirement)', async () => {
      const created = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: null,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: concurrent decision race',
      });
      const caseId = (created as { outcome: 'SUCCESS'; decisionCase: { id: string } }).decisionCase.id;
      createdCaseIds.push(caseId);

      const submitted = await approvalService.submitApprovalRequest({
        tenantId,
        decisionCaseId: caseId,
        expectedCaseVersion: 1,
        submittedByUserId: preparerId,
        basePlanType: 'TIER_1',
        actionAuthorityCapabilityId: usersCreatePermissionId,
      });
      const request = (submitted as { outcome: 'SUCCESS'; request: { id: string; requirements: Array<{ id: string }> } }).request;

      const [a, b] = await Promise.all([
        approvalService.recordApprovalDecision({
          tenantId,
          approvalRequestId: request.id,
          approvalRequirementId: request.requirements[0]!.id,
          decidedByUserId: actionAuthorityApproverId,
          decision: 'GRANTED',
          reason: 'Race A',
        }),
        approvalService.recordApprovalDecision({
          tenantId,
          approvalRequestId: request.id,
          approvalRequirementId: request.requirements[0]!.id,
          decidedByUserId: actionAuthorityApproverId,
          decision: 'REJECTED',
          reason: 'Race B',
        }),
      ]);
      const successCount = [a, b].filter((r) => r.outcome.startsWith('SUCCESS')).length;
      expect(successCount).toBe(1);

      const decisions = await prisma.approvalDecision.findMany({
        where: { approvalRequirementId: request.requirements[0]!.id },
      });
      expect(decisions).toHaveLength(1); // final persisted state: exactly one decision row survives the race
    });

    it('CHECK CONSTRAINT: a direct write creating a second PENDING ApprovalRequest for the same case bypassing the service is rejected by the database', async () => {
      const created = await decisionCaseService.createDecisionCase({
        tenantId,
        subjectType: DecisionCaseSubjectType.GENERAL,
        subjectId: null,
        initiatedByUserId: initiatorId,
        preparedByUserId: preparerId,
        purpose: 'E2E: direct-write partial-unique-index proof',
      });
      const caseId = (created as { outcome: 'SUCCESS'; decisionCase: { id: string } }).decisionCase.id;
      createdCaseIds.push(caseId);

      await prisma.approvalRequest.create({
        data: { tenantId, decisionCaseId: caseId, version: 1, status: ApprovalRequestStatus.PENDING },
      });

      await expect(
        prisma.approvalRequest.create({
          data: { tenantId, decisionCaseId: caseId, version: 2, status: ApprovalRequestStatus.PENDING },
        }),
      ).rejects.toBeTruthy(); // idx_approval_requests_tenant_case_pending
    });
  });
});
