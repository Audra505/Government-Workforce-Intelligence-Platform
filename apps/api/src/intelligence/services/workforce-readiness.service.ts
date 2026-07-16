// Reference: governance/GD-M31-1.md — Decisions 2, 3, 5, 6, 7, 8, 12
// Reference: spec/01_requirements.md — FR-410 (Workforce Readiness Scoring), FR-900 (Explainability)
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// WorkforceReadinessService implements the governed readiness-deterministic-v1 formula.
// No external AI, LLM, or HTTP calls of any kind (GD-M31-1 Decision 12).
// Reuses VacancyRiskService directly for the Vacancy Pressure factor — the same governed
// call the vacancy-risk endpoint makes (GD-M31-1 Decision 5 rationale).
// tenantId is never derived from caller input — always from JWT context via the controller.
//
// Returns the shared IntelligenceExplainabilityOutput shape (riskScore/riskLevel field
// names) even though the values represent readinessScore/readinessLevel — the controller
// maps these onto readiness-specific field names at the HTTP response boundary
// (GD-M31-1 Decision 8 naming note). This keeps the shared interface untouched.
//
// Any change to factor weights, thresholds, or formula structure requires a new
// governance decision.

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import type { RiskFactor, IntelligenceExplainabilityOutput } from '../interfaces/intelligence-explainability.interface';
import { VacancyRiskService } from './vacancy-risk.service';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class WorkforceReadinessService {
  private readonly logger = new Logger(WorkforceReadinessService.name);

  static readonly FORMULA_VERSION = 'readiness-deterministic-v1';

  constructor(
    private readonly prisma: PrismaService,
    private readonly vacancyRiskService: VacancyRiskService,
  ) {}

  // -------------------------------------------------------------------------
  // Public API — score()
  // -------------------------------------------------------------------------

  async score(tenantId: string): Promise<IntelligenceExplainabilityOutput> {
    const now = new Date();

    const [
      activeEmployees,
      pendingOnboarding,
      onLeave,
      suspended,
      activePositions,
      employeesWithActivePosition,
      activeCertifications,
      totalCertifications,
    ] = await Promise.all([
      this.prisma.employee.count({ where: { tenantId, deletedAt: null, employmentStatus: 'ACTIVE' } }),
      this.prisma.employee.count({ where: { tenantId, deletedAt: null, employmentStatus: 'PENDING_ONBOARDING' } }),
      this.prisma.employee.count({ where: { tenantId, deletedAt: null, employmentStatus: 'ON_LEAVE' } }),
      this.prisma.employee.count({ where: { tenantId, deletedAt: null, employmentStatus: 'SUSPENDED' } }),
      this.prisma.position.count({ where: { tenantId, deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.employee.count({
        where: { tenantId, deletedAt: null, employmentStatus: 'ACTIVE', positionId: { not: null } },
      }),
      this.prisma.employeeCertification.count({
        where: { status: 'ACTIVE', employee: { tenantId, deletedAt: null } },
      }),
      this.prisma.employeeCertification.count({
        where: { employee: { tenantId, deletedAt: null } },
      }),
    ]);

    // GD-M31-1 Decision 5: Vacancy Pressure Factor reuses VacancyRiskService.score()
    // with the exact same governed default call the vacancy-risk endpoint makes.
    let avgVacancyRisk = 0;
    try {
      const vacancyResult = await this.vacancyRiskService.score(tenantId, {});
      avgVacancyRisk = vacancyResult.items.length > 0
        ? vacancyResult.items.reduce((sum, item) => sum + item.riskScore, 0) / vacancyResult.items.length
        : 0;
    } catch (err) {
      this.logger.warn(
        'Vacancy Pressure Factor: VacancyRiskService.score() failed; defaulting to 0 (no pressure)',
        err instanceof Error ? err.message : String(err),
      );
      avgVacancyRisk = 0;
    }

    // -- Staffing Coverage Factor (max 30 pts) --
    const staffingDenominator = activeEmployees + pendingOnboarding + onLeave + suspended;
    const staffingRatio = staffingDenominator > 0 ? activeEmployees / staffingDenominator : null;
    const staffingFactor = staffingRatio !== null ? Math.round(staffingRatio * 30) : 15;

    // -- Position Capacity Factor (max 20 pts) --
    const capacityRatio = activePositions > 0 ? Math.min(1, employeesWithActivePosition / activePositions) : null;
    const capacityFactor = capacityRatio !== null ? Math.round(capacityRatio * 20) : 10;

    // -- Vacancy Pressure Factor (max 30 pts) --
    const vacancyPressureFactor = Math.round(((100 - avgVacancyRisk) / 100) * 30);

    // -- Certification Compliance Factor (max 20 pts) --
    const complianceRatio = totalCertifications > 0 ? activeCertifications / totalCertifications : null;
    const complianceFactor = complianceRatio !== null ? Math.round(complianceRatio * 20) : 10;

    const readinessScore = Math.min(
      100,
      staffingFactor + capacityFactor + vacancyPressureFactor + complianceFactor,
    );
    const readinessLevel = this.computeReadinessLevel(readinessScore);
    const confidence = this.computeConfidence(activePositions, totalCertifications, staffingDenominator);

    const factors = this.buildFactors(
      staffingFactor, staffingRatio,
      capacityFactor, capacityRatio,
      vacancyPressureFactor, avgVacancyRisk,
      complianceFactor, complianceRatio,
    );

    const reasoning = this.composeReasoning(readinessLevel, factors);

    return {
      riskScore: readinessScore,
      riskLevel: readinessLevel,
      confidence,
      reasoning,
      factors,
      computedAt: now.toISOString(),
      formulaVersion: WorkforceReadinessService.FORMULA_VERSION,
    };
  }

  // -------------------------------------------------------------------------
  // Readiness level thresholds — governed in GD-M31-1 Decision 6
  // -------------------------------------------------------------------------

  private computeReadinessLevel(score: number): string {
    if (score >= 75) return 'READY';
    if (score >= 50) return 'DEVELOPING';
    if (score >= 25) return 'AT_RISK';
    return 'CRITICAL';
  }

  // -------------------------------------------------------------------------
  // Confidence — governed rules from GD-M31-1 Decision 7
  // -------------------------------------------------------------------------

  private computeConfidence(
    activePositions: number,
    totalCertifications: number,
    staffingDenominator: number,
  ): number {
    let confidence = 100;
    if (activePositions === 0) confidence *= 0.5;
    if (totalCertifications === 0) confidence *= 0.7;
    if (staffingDenominator < 3) confidence *= 0.6;
    return Math.max(10, Math.floor(confidence));
  }

  // -------------------------------------------------------------------------
  // Factors array — always 4 entries (GD-M31-1 Decision 5)
  // -------------------------------------------------------------------------

  private buildFactors(
    staffingFactor: number, staffingRatio: number | null,
    capacityFactor: number, capacityRatio: number | null,
    vacancyPressureFactor: number, avgVacancyRisk: number,
    complianceFactor: number, complianceRatio: number | null,
  ): RiskFactor[] {
    const staffingPct = staffingRatio !== null ? Math.round(staffingRatio * 100) : null;
    const capacityPct = capacityRatio !== null ? Math.round(capacityRatio * 100) : null;
    const compliancePct = complianceRatio !== null ? Math.round(complianceRatio * 100) : null;
    const pressureLabel = this.vacancyPressureLabel(avgVacancyRisk);

    return [
      {
        name: 'staffingCoverage',
        contribution: staffingFactor,
        detail: staffingPct !== null
          ? `${staffingPct}% of current workforce active`
          : 'No current workforce data available',
      },
      {
        name: 'positionCapacity',
        contribution: capacityFactor,
        detail: capacityPct !== null
          ? `${capacityPct}% of active positions filled`
          : 'No active positions to assess',
      },
      {
        name: 'vacancyPressure',
        contribution: vacancyPressureFactor,
        detail: `${pressureLabel} vacancy risk across open positions`,
      },
      {
        name: 'certificationCompliance',
        contribution: complianceFactor,
        detail: compliancePct !== null
          ? `${compliancePct}% of certifications active`
          : 'No certifications assigned to assess',
      },
    ];
  }

  private vacancyPressureLabel(avgVacancyRisk: number): string {
    if (avgVacancyRisk >= 75) return 'Severe';
    if (avgVacancyRisk >= 50) return 'High';
    if (avgVacancyRisk >= 25) return 'Moderate';
    return 'Low';
  }

  // -------------------------------------------------------------------------
  // Reasoning — dynamically composed from the actual ranked factors (GD-M31-1 D8)
  // -------------------------------------------------------------------------

  private composeReasoning(readinessLevel: string, factors: RiskFactor[]): string {
    const maxByName: Record<string, number> = {
      staffingCoverage: 30,
      positionCapacity: 20,
      vacancyPressure: 30,
      certificationCompliance: 20,
    };
    const phraseByName: Record<string, { strong: string; weak: string }> = {
      staffingCoverage:        { strong: 'strong staffing coverage',        weak: 'staffing coverage below target' },
      positionCapacity:        { strong: 'solid position capacity',         weak: 'position capacity below target' },
      vacancyPressure:         { strong: 'low vacancy pressure',            weak: 'elevated vacancy pressure' },
      certificationCompliance: { strong: 'strong certification compliance', weak: 'certification compliance below target' },
    };

    const ranked = [...factors].sort(
      (a, b) => (b.contribution / maxByName[b.name]!) - (a.contribution / maxByName[a.name]!),
    );
    const top = ranked[0]!;
    const bottom = ranked[ranked.length - 1]!;
    const bottomRatio = bottom.contribution / maxByName[bottom.name]!;

    let sentence = `Workforce readiness is ${readinessLevel}, driven primarily by ${phraseByName[top.name]!.strong}`;
    if (bottom.name !== top.name && bottomRatio < 0.6) {
      sentence += `, offset by ${phraseByName[bottom.name]!.weak}`;
    }
    sentence += '.';
    return sentence;
  }
}
