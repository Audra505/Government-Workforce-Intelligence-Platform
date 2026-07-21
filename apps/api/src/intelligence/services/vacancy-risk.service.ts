// Reference: governance/GD-M30-1.md — Decisions 3, 5, 6, 7, 8, 12
// Reference: spec/01_requirements.md — FR-401 (Vacancy Risk Prediction), FR-900 (Explainability)
// Reference: spec/07_security_architecture.md — SEC-003 Tenant Isolation
//
// VacancyRiskService implements the governed deterministic-v1 scoring formula.
// No external AI, LLM, or HTTP calls of any kind (GD-M30-1 Decision 12).
// All scores are fully reproducible from vacancy field values and a reference timestamp.
// tenantId is never derived from caller input — always from JWT context via the controller.
// Any change to factor weights, thresholds, or formula structure requires a new governance decision.

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import type { RiskFactor, IntelligenceExplainabilityOutput } from '../interfaces/intelligence-explainability.interface';
import type { VacancyRiskQueryDto } from '../dto/vacancy-risk-query.dto';
import { SnapshotWriterService } from './snapshot-writer.service';

// ---------------------------------------------------------------------------
// Public output types
// ---------------------------------------------------------------------------

export interface VacancyRiskItem extends IntelligenceExplainabilityOutput {
  vacancyId: string;
  positionTitle: string;
  departmentName: string | null;
  status: string;
  daysOpen: number;
  priority: string | null;
}

export interface VacancyRiskResult {
  items: VacancyRiskItem[];
  total: number;
}

// ---------------------------------------------------------------------------
// Internal Prisma query shape
// ---------------------------------------------------------------------------

type VacancyRow = {
  id: string;
  tenantId: string;
  priority: string | null;
  status: string;
  expectedFillDate: Date | null;
  filledAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  position: {
    title: string;
    department: {
      name: string;
    };
  };
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class VacancyRiskService {
  private readonly logger = new Logger(VacancyRiskService.name);

  static readonly FORMULA_VERSION = 'deterministic-v1';

  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshotWriter: SnapshotWriterService,
  ) {}

  // -------------------------------------------------------------------------
  // Public API — score()
  // -------------------------------------------------------------------------

  async score(tenantId: string, query: VacancyRiskQueryDto): Promise<VacancyRiskResult> {
    const effectivePageSize = query.pageSize ?? 10;
    const now = new Date();

    const rawVacancies = await this.prisma.vacancy.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.status
          ? { status: query.status }
          : { status: { in: ['OPEN', 'IN_RECRUITMENT'] } }),
      },
      include: {
        position: {
          include: {
            department: true,
          },
        },
      },
    });

    const pairs: Array<{ item: VacancyRiskItem; createdAt: Date }> = [];

    for (const vacancy of rawVacancies as VacancyRow[]) {
      try {
        const item = this.scoreVacancy(vacancy, now);
        if (item !== null) {
          pairs.push({ item, createdAt: vacancy.createdAt });
        }
      } catch (err) {
        this.logger.warn(
          `Skipping vacancy ${vacancy.id} due to scoring error`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // Governed sort: riskScore desc, createdAt asc for ties (GD-M30-1 Decision 6)
    pairs.sort((a, b) => {
      if (b.item.riskScore !== a.item.riskScore) return b.item.riskScore - a.item.riskScore;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const total = pairs.length;
    const items = pairs.slice(0, effectivePageSize).map(p => p.item);

    // GD-M34-1 Decision 16: write-on-query snapshot. VacancyRiskService
    // returns a ranked LIST, not a single score — there is no "riskScore"
    // field on VacancyRiskResult to snapshot directly. The headline value
    // recorded here is the average riskScore across the returned items,
    // the same derived aggregate WorkforceReadinessService already computes
    // internally for its own Vacancy Pressure factor — this is an
    // implementation-time interpretation of "the computed value" for a
    // list-shaped signal, not a new scoring formula (no new weight or
    // threshold is introduced; it is a plain arithmetic mean of already-
    // governed per-vacancy riskScore values).
    const avgRiskScore = items.length > 0
      ? Math.round((items.reduce((sum, item) => sum + item.riskScore, 0) / items.length) * 10) / 10
      : null;
    await this.snapshotWriter.write({
      tenantId,
      signalType: 'VACANCY_RISK',
      scopeType: 'TENANT',
      score: avgRiskScore,
      level: null,
      confidence: items.length > 0 ? 100 : 10,
      formulaVersion: VacancyRiskService.FORMULA_VERSION,
      computedAt: now,
    });

    return { items, total };
  }

  // -------------------------------------------------------------------------
  // Core scoring — one vacancy at a time
  // -------------------------------------------------------------------------

  private scoreVacancy(vacancy: VacancyRow, now: Date): VacancyRiskItem | null {
    // Defense-in-depth: deletedAt and status already filtered in the WHERE clause
    if (vacancy.deletedAt !== null) return null;
    if (!['OPEN', 'IN_RECRUITMENT'].includes(vacancy.status)) return null;

    const daysOpen = Math.floor(
      (now.getTime() - vacancy.createdAt.getTime()) / 86_400_000,
    );

    // GD-M30-1 D7: future createdAt — exclude and log warning
    if (daysOpen < 0) {
      this.logger.warn(
        `Vacancy ${vacancy.id} has createdAt in the future (${vacancy.createdAt.toISOString()}); excluding from scoring`,
      );
      return null;
    }

    const daysUntilFill =
      vacancy.expectedFillDate !== null
        ? Math.floor(
            (vacancy.expectedFillDate.getTime() - now.getTime()) / 86_400_000,
          )
        : null;

    const ageFactor      = this.computeAgeFactor(daysOpen);
    const priorityFactor = this.computePriorityFactor(vacancy.priority);
    const fillDateFactor = this.computeFillDateFactor(daysUntilFill);
    const statusFactor   = this.computeStatusFactor(vacancy.status);

    const riskScore  = Math.min(100, ageFactor + priorityFactor + fillDateFactor + statusFactor);
    const riskLevel  = this.computeRiskLevel(riskScore);
    const confidence = this.computeConfidence(vacancy.priority, vacancy.expectedFillDate, daysOpen);

    const factors  = this.buildFactors(ageFactor, priorityFactor, fillDateFactor, statusFactor, daysOpen, vacancy.priority, daysUntilFill);
    const reasoning = this.composeReasoning(vacancy.priority, daysOpen, vacancy.expectedFillDate, daysUntilFill);

    return {
      vacancyId:      vacancy.id,
      positionTitle:  vacancy.position.title,
      departmentName: vacancy.position.department?.name ?? null,
      status:         vacancy.status,
      daysOpen,
      priority:       vacancy.priority,
      riskScore,
      riskLevel,
      confidence,
      reasoning,
      factors,
      computedAt:      now.toISOString(),
      formulaVersion:  VacancyRiskService.FORMULA_VERSION,
    };
  }

  // -------------------------------------------------------------------------
  // Factor computations — governed weights from GD-M30-1 Decision 5
  // -------------------------------------------------------------------------

  private computeAgeFactor(daysOpen: number): number {
    if (daysOpen >= 90) return 40;
    if (daysOpen >= 60) return 30;
    if (daysOpen >= 30) return 20;
    if (daysOpen >= 14) return 10;
    return 0;
  }

  private computePriorityFactor(priority: string | null): number {
    if (priority === 'CRITICAL') return 40;
    if (priority === 'HIGH')     return 25;
    if (priority === 'MEDIUM')   return 10;
    return 0; // LOW or null
  }

  private computeFillDateFactor(daysUntilFill: number | null): number {
    if (daysUntilFill === null)  return 0;
    if (daysUntilFill < 0)       return 15; // overdue
    if (daysUntilFill <= 7)      return 10;
    if (daysUntilFill <= 14)     return 5;
    return 0;
  }

  private computeStatusFactor(status: string): number {
    return status === 'OPEN' ? 5 : 0;
  }

  // -------------------------------------------------------------------------
  // Risk level thresholds — governed in GD-M30-1 Decision 6
  // -------------------------------------------------------------------------

  private computeRiskLevel(riskScore: number): string {
    if (riskScore >= 75) return 'CRITICAL';
    if (riskScore >= 50) return 'HIGH';
    if (riskScore >= 25) return 'MEDIUM';
    return 'LOW';
  }

  // -------------------------------------------------------------------------
  // Confidence — governed rules from GD-M30-1 Decision 7
  // -------------------------------------------------------------------------

  private computeConfidence(
    priority: string | null,
    expectedFillDate: Date | null,
    daysOpen: number,
  ): number {
    const hasPriority = priority !== null;
    const hasFillDate = expectedFillDate !== null;

    let base: number;
    if (hasPriority && hasFillDate)   base = 100;
    else if (hasPriority)             base = 70;
    else if (hasFillDate)             base = 50;
    else                              base = 40;

    // daysOpen === 0: vacancy created today — data too fresh to score reliably
    return daysOpen === 0 ? Math.floor(base * 0.6) : base;
  }

  // -------------------------------------------------------------------------
  // Factors array — non-zero contributions only (GD-M30-1 Decision 5)
  // -------------------------------------------------------------------------

  private buildFactors(
    ageFactor: number,
    priorityFactor: number,
    fillDateFactor: number,
    statusFactor: number,
    daysOpen: number,
    priority: string | null,
    daysUntilFill: number | null,
  ): RiskFactor[] {
    const factors: RiskFactor[] = [];

    if (ageFactor > 0) {
      const ageDetail = daysOpen >= 90 ? 'Open 90+ days'
        : daysOpen >= 60 ? 'Open 60–89 days'
        : daysOpen >= 30 ? 'Open 30–59 days'
        : 'Open 14–29 days';
      factors.push({ name: 'vacancyAge', contribution: ageFactor, detail: ageDetail });
    }

    if (priorityFactor > 0) {
      factors.push({
        name: 'priority',
        contribution: priorityFactor,
        detail: `Priority: ${priority}`,
      });
    }

    if (fillDateFactor > 0) {
      const fillDetail = daysUntilFill !== null && daysUntilFill < 0
        ? 'Expected fill date overdue'
        : daysUntilFill !== null && daysUntilFill <= 7
        ? 'Expected fill date due within 7 days'
        : 'Expected fill date due within 14 days';
      factors.push({ name: 'fillDateProximity', contribution: fillDateFactor, detail: fillDetail });
    }

    if (statusFactor > 0) {
      factors.push({
        name: 'vacancyStatus',
        contribution: statusFactor,
        detail: 'Status OPEN — not yet in active recruitment',
      });
    }

    return factors;
  }

  // -------------------------------------------------------------------------
  // Reasoning — dynamically composed from contributing factors (GD-M30-1 D8)
  // -------------------------------------------------------------------------

  private composeReasoning(
    priority: string | null,
    daysOpen: number,
    expectedFillDate: Date | null,
    daysUntilFill: number | null,
  ): string {
    const priorityPart = priority
      ? `${priority} priority vacancy`
      : 'No-priority vacancy';

    const agePart = daysOpen >= 90 ? 'open 90+ days'
      : daysOpen >= 60 ? 'open 60–89 days'
      : daysOpen >= 30 ? 'open 30–59 days'
      : daysOpen >= 14 ? 'open 14–29 days'
      : daysOpen === 1 ? 'open 1 day'
      : daysOpen === 0 ? 'created today'
      : `open ${daysOpen} days`;

    let fillPart: string;
    if (expectedFillDate === null) {
      fillPart = 'with no expected fill date set';
    } else if (daysUntilFill !== null && daysUntilFill < 0) {
      fillPart = 'with fill date overdue';
    } else if (daysUntilFill !== null && daysUntilFill <= 7) {
      fillPart = 'with fill date due within 7 days';
    } else if (daysUntilFill !== null && daysUntilFill <= 14) {
      fillPart = 'with fill date due within 14 days';
    } else {
      fillPart = 'with fill date on target';
    }

    return `${priorityPart} ${agePart} ${fillPart}.`;
  }
}
