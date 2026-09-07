import { registerAs } from '@nestjs/config';

// Reference: governance/GD-M39-1.md — Decision 13 (Automatic Workers: "a
// configurable interval and batch size", "a configurable maximum attempt
// count", "An hourly default interval, governed and configurable")
//
// Namespace 'audit' — access via configService.get('audit.recovery') /
// configService.get('audit.verification'). Mirrors app.config.ts's
// registerAs() + parseInt(process.env[...]) pattern exactly.

export default registerAs('audit', () => ({
  recovery: {
    intervalMs: parseInt(process.env['AUDIT_RECOVERY_INTERVAL_MS'] ?? '30000', 10),
    batchSize: parseInt(process.env['AUDIT_RECOVERY_BATCH_SIZE'] ?? '25', 10),
    maxAttempts: parseInt(process.env['AUDIT_RECOVERY_MAX_ATTEMPTS'] ?? '10', 10),
    baseBackoffMs: parseInt(process.env['AUDIT_RECOVERY_BASE_BACKOFF_MS'] ?? '60000', 10),
    maxBackoffMs: parseInt(process.env['AUDIT_RECOVERY_MAX_BACKOFF_MS'] ?? '3600000', 10),
    // GD-M39-1 Decision 12/13 — how long an IN_PROGRESS claim may stand
    // before another cycle treats it as a crashed worker's stale claim.
    claimTimeoutMs: parseInt(process.env['AUDIT_RECOVERY_CLAIM_TIMEOUT_MS'] ?? '120000', 10),
  },
  verification: {
    // Hourly default (GD-M39-1 Decision 13).
    intervalMs: parseInt(process.env['AUDIT_VERIFICATION_INTERVAL_MS'] ?? '3600000', 10),
    batchSize: parseInt(process.env['AUDIT_VERIFICATION_BATCH_SIZE'] ?? '10', 10),
    claimTimeoutMs: parseInt(process.env['AUDIT_VERIFICATION_CLAIM_TIMEOUT_MS'] ?? '300000', 10),
  },
}));

export interface AuditRecoveryConfig {
  intervalMs: number;
  batchSize: number;
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  claimTimeoutMs: number;
}

export interface AuditVerificationConfig {
  intervalMs: number;
  batchSize: number;
  claimTimeoutMs: number;
}
