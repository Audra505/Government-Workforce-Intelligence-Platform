// Reference: governance/GD-M39-1.md — Decision 8 (Deterministic Per-Tenant Hash Chaining)
//
// Pure, side-effect-free canonicalization and hashing for the M39 per-tenant
// audit hash chain. No database access, no Prisma import — consumed by both
// the write path (AuditService) and the verification path
// (AuditChainVerificationService) so the two can never silently diverge
// (Decision 24: "Canonical hash proven deterministic across write and
// verification paths").
//
// Algorithm: SHA-256 (Node's built-in crypto module — zero new dependency),
// lowercase hex output, over a fixed-position 14-element JSON array (never
// delimiter-concatenated strings).

import { createHash } from 'node:crypto';

export const HASH_VERSION_V1 = 'v1';

// GD-M39-1 Decision 8 — version-keyed dispatch. A future canonicalization
// change adds a new entry here; it never mutates canonicalizeAuditEventV1,
// so an existing row's hash under its own recorded hashVersion never
// collides with a differently-versioned row's hash.
export type AuditHashVersion = typeof HASH_VERSION_V1;

// The 14 governed fields, in their fixed order. Every field is REQUIRED on
// this interface — the array position is what carries meaning; a caller
// must pass `null` explicitly for an absent value (entityType, entityId,
// previousHash), never omit the property.
export interface AuditHashFields {
  hashVersion: string;
  tenantId: string;
  sequenceNo: bigint;
  eventId: string;
  userId: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  result: string;
  // Raw (pre-canonicalization) metadata — canonicalizeAuditEventV1 performs
  // the recursive key-sort itself. Pass null (never undefined) when there
  // is no metadata for this event.
  metadata: unknown;
  occurredAt: Date;
  createdAt: Date;
  retentionUntil: Date;
  previousHash: string | null;
}

// GD-M39-1 Decision 8 — object keys recursively sorted (ascending UTF-16
// code-unit order — JavaScript's default Array.prototype.sort() string
// comparator already does this) at every nesting depth; array element order
// is preserved exactly as-is, never sorted; a property whose value is
// undefined is omitted (mirrors native JSON.stringify behavior); an
// explicit null is preserved.
export function sortMetadataKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortMetadataKeysDeep(item));
  }

  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record).sort();
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      const propertyValue = record[key];
      if (propertyValue === undefined) continue; // native JSON.stringify omission behavior
      out[key] = sortMetadataKeysDeep(propertyValue);
    }
    return out;
  }

  return value;
}

// BigInt is never passed to JSON.stringify directly (it throws) and never
// coerced to a lossy JS number — always its exact decimal string.
function sequenceNoToDecimalString(sequenceNo: bigint): string {
  return sequenceNo.toString(10);
}

// Exact ISO-8601 UTC string, millisecond precision, Z suffix — Date's own
// toISOString() already produces exactly this format.
function toIsoUtcString(date: Date): string {
  return date.toISOString();
}

// GD-M39-1 Decision 8 — the v1 canonical representation: a fixed-position
// JSON array, UTF-8 encoded before hashing (Node's Buffer/Hash machinery
// handles the UTF-8 encoding step in computeAuditEventHash below). Null
// representation: any null element is emitted as JSON `null` at its fixed
// array position — the array never shrinks; position, not presence,
// carries meaning.
export function canonicalizeAuditEventV1(fields: AuditHashFields): string {
  const canonicalMetadata =
    fields.metadata === undefined || fields.metadata === null
      ? null
      : sortMetadataKeysDeep(fields.metadata);

  const canonicalArray: unknown[] = [
    fields.hashVersion,
    fields.tenantId,
    sequenceNoToDecimalString(fields.sequenceNo),
    fields.eventId,
    fields.userId,
    fields.action,
    fields.entityType,
    fields.entityId,
    fields.result,
    canonicalMetadata,
    toIsoUtcString(fields.occurredAt),
    toIsoUtcString(fields.createdAt),
    toIsoUtcString(fields.retentionUntil),
    fields.previousHash,
  ];

  return JSON.stringify(canonicalArray);
}

export type AuditHashCanonicalizer = (fields: AuditHashFields) => string;

// Version-keyed canonicalizer map — verification dispatches per-row via
// this map, never a single assumed-current rule (Decision 8).
export const AUDIT_HASH_CANONICALIZERS: Readonly<Record<string, AuditHashCanonicalizer>> = {
  [HASH_VERSION_V1]: canonicalizeAuditEventV1,
};

export class UnknownAuditHashVersionError extends Error {
  constructor(public readonly hashVersion: string) {
    super(`Unknown audit hash version: "${hashVersion}"`);
  }
}

export function canonicalizeAuditEvent(fields: AuditHashFields): string {
  const canonicalizer = AUDIT_HASH_CANONICALIZERS[fields.hashVersion];
  if (!canonicalizer) {
    throw new UnknownAuditHashVersionError(fields.hashVersion);
  }
  return canonicalizer(fields);
}

// SHA-256, lowercase hex output, 64 characters.
export function computeAuditEventHash(canonicalJson: string): string {
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

// Convenience: canonicalize then hash, in one call — the function both the
// write path and the verification path should use for "what is this row's
// hash, given these fields."
export function hashAuditEvent(fields: AuditHashFields): string {
  return computeAuditEventHash(canonicalizeAuditEvent(fields));
}
