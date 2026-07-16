// Reference: governance/GD-M30-1.md — Decision 8 (Explainability Response Contract)
// Reference: spec/11_ai_architecture.md — AI-002 (Explainability), FR-900, FR-902
//
// Foundation interface for all Phase 4 intelligence services.
// Every future service (Forecasting, Attrition, Matching, WorkforceReadiness) must return
// IntelligenceExplainabilityOutput or a superset — no score without explanation.
// Any future change to this interface requires a governance decision.

export interface RiskFactor {
  name: string;           // 'vacancyAge' | 'priority' | 'fillDateProximity' | 'vacancyStatus'
  contribution: number;   // points contributed by this factor to riskScore
  detail: string;         // human-readable explanation of the input value
}

export interface IntelligenceExplainabilityOutput {
  riskScore: number;        // 0–100 integer
  riskLevel: string;        // LOW | MEDIUM | HIGH | CRITICAL (governed thresholds in GD-M30-1 D6)
  confidence: number;       // 0–100; data sufficiency indicator (governed rules in GD-M30-1 D7)
  reasoning: string;        // dynamically composed sentence from contributing factors (never hardcoded)
  factors: RiskFactor[];    // itemized non-zero contributing factors only
  computedAt: string;       // ISO 8601 timestamp of computation
  formulaVersion: string;   // 'deterministic-v1' for M30; change requires new governance decision
}
